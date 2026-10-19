import nodemailer, { type SentMessageInfo } from "nodemailer";
import { env } from "@/modules/core/env";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import { normalizeSubject } from "@/modules/mailbox/threading";
import { isEmailVerificationBlocking } from "@/modules/emailVerification/service";
import {
  isDoNotResendHardBlock,
  isNonActionablePlatformTarget,
  isSendBlockedStatus,
  isTargetActionBlocked
} from "@/modules/outreach/status";
import { unresolvedVariables } from "@/modules/templates/render";
import { clearEmailDraft } from "./drafts";
import {
  getMessageIdDomain,
  selectSmtpIdentity
} from "./from-identities";
import {
  hasUnsavedAcceptedSend,
  markSendRecordRecovered
} from "./recover-send";
import { smtpTransportOptions } from "./transport";

export type SendableTarget = {
  id: string;
  contactId: string | null;
  contactEmail: string | null;
  companyName: string;
  dedupeKey: string;
  sourceType: string;
  sourceUrl: string | null;
  status: string;
  doNotResend: number;
  emailVerificationStatus: string | null;
  threadId: string | null;
  threadSubject: string | null;
  firstMessageId: string | null;
  lastMessageId: string | null;
};

export type SendOutcome =
  | {
      ok: true;
      outboundSendId: string;
      fromEmail: string;
      messageId: string;
      demo: boolean;
    }
  | {
      ok: false;
      reason:
        | "invalid_message"
        | "missing_target"
        | "blocked"
        | "unsaved_accepted_send"
        | "smtp_disabled"
        | "duplicate"
        | "send_failed"
        | "persist_failed";
      message: string;
    };

export async function sendOutboundEmail({
  targetId,
  threadId = null,
  subject,
  body,
  fromEmail: requestedFrom = null,
  sendKey = createId("sendkey"),
  createFollowup = false,
  followupDays = 5
}: {
  targetId: string;
  threadId?: string | null;
  subject: string;
  body: string;
  fromEmail?: string | null;
  sendKey?: string;
  createFollowup?: boolean;
  followupDays?: number;
}): Promise<SendOutcome> {
  const target = getSendableTarget(targetId, threadId);

  if (!target) {
    return { ok: false, reason: "missing_target", message: "ReachLog could not find this target." };
  }

  if (
    !subject ||
    !body ||
    unresolvedVariables(subject + "\n" + body).length ||
    subject.length > 300 ||
    body.length > 50_000 ||
    /[\r\n]/.test(subject)
  ) {
    return {
      ok: false,
      reason: "invalid_message",
      message:
        "Check the subject and message length, and replace all template variables before sending."
    };
  }

  if (
    !target.contactEmail ||
    isTargetActionBlocked(target) ||
    isEmailVerificationBlocking(target.emailVerificationStatus)
  ) {
    return {
      ok: false,
      reason: "blocked",
      message: getSendBlockedMessage(target)
    };
  }

  if (hasUnsavedAcceptedSend(targetId)) {
    return {
      ok: false,
      reason: "unsaved_accepted_send",
      message:
        "An earlier email was accepted by your mail server but is not in your history yet. Resolve that send before sending again."
    };
  }

  const fromIdentity = selectSmtpIdentity(requestedFrom);
  const fromEmail = fromIdentity.from;
  const messageId = createLocalMessageId(fromEmail);
  const replyToMessageId = target.lastMessageId ?? target.firstMessageId ?? undefined;

  if (env.DEMO_MODE) {
    const outboundSendId = createPendingOutboundSend({
      target,
      contactEmail: target.contactEmail,
      subject,
      body,
      fromEmail,
      messageId,
      sendKey
    });

    if (!outboundSendId.inserted) {
      return {
        ok: false,
        reason: "duplicate",
        message: "This send was already submitted. Duplicate send was blocked."
      };
    }

    persistSentEmail({
      target: { ...target, contactEmail: target.contactEmail },
      subject,
      body,
      fromEmail,
      messageId,
      replyToMessageId,
      outboundSendId: outboundSendId.id,
      rawResult: {
        accepted: [target.contactEmail],
        rejected: [],
        response: "demo_mode"
      },
      createFollowup,
      followupDays
    });
    return { ok: true, outboundSendId: outboundSendId.id, fromEmail, messageId, demo: true };
  }

  if (!env.SMTP_ENABLED) {
    return {
      ok: false,
      reason: "smtp_disabled",
      message: "Email sending is off. Connect and enable your SMTP account in Settings."
    };
  }

  const outboundSendId = createPendingOutboundSend({
    target,
    contactEmail: target.contactEmail,
    subject,
    body,
    fromEmail,
    messageId,
    sendKey
  });

  if (!outboundSendId.inserted) {
    return {
      ok: false,
      reason: "duplicate",
      message: "This send was already submitted. Duplicate send was blocked."
    };
  }

  const transporter = nodemailer.createTransport(
    smtpTransportOptions({
      user: fromIdentity.smtpUser,
      pass: fromIdentity.smtpPass
    })
  );

  let result: SentMessageInfo;

  try {
    result = await transporter.sendMail({
      from: fromEmail,
      to: target.contactEmail,
      subject,
      text: body,
      messageId,
      inReplyTo: replyToMessageId,
      references: replyToMessageId ? [replyToMessageId] : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    markOutboundSendFailed(outboundSendId.id, message);
    createTargetEvent(targetId, "send_failed", { messageId, subject, error: message });
    return { ok: false, reason: "send_failed", message };
  }

  try {
    persistSentEmail({
      target: { ...target, contactEmail: target.contactEmail },
      subject,
      body,
      fromEmail,
      messageId,
      replyToMessageId,
      outboundSendId: outboundSendId.id,
      rawResult: result,
      createFollowup,
      followupDays
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    markOutboundSendPersistenceFailed(outboundSendId.id, message);
    createTargetEvent(targetId, "send_persist_failed_after_smtp_accept", {
      messageId,
      error: message
    });
    return { ok: false, reason: "persist_failed", message };
  }

  return { ok: true, outboundSendId: outboundSendId.id, fromEmail, messageId, demo: false };
}

export function getSendableTarget(targetId: string, threadId: string | null = null) {
  return getSqlite()
    .prepare(
      `
      SELECT
        targets.id,
        targets.contact_id as contactId,
        targets.company_name as companyName,
        targets.dedupe_key as dedupeKey,
        targets.source_type as sourceType,
        targets.source_url as sourceUrl,
        targets.status,
        targets.do_not_resend as doNotResend,
        contacts.email as contactEmail,
        contacts.email_verification_status as emailVerificationStatus,
        threads.id as threadId,
        threads.subject as threadSubject,
        threads.first_message_id as firstMessageId,
        threads.last_message_id as lastMessageId
      FROM targets
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      LEFT JOIN threads ON threads.target_id = targets.id
      WHERE targets.id = ?
        AND (? IS NULL OR threads.id = ?)
      ORDER BY threads.updated_at DESC
      LIMIT 1
    `
    )
    .get(targetId, threadId, threadId) as SendableTarget | undefined;
}

export function persistSentEmail({
  target,
  subject,
  body,
  fromEmail,
  messageId,
  replyToMessageId,
  outboundSendId,
  rawResult,
  createFollowup,
  followupDays,
  sentAt,
  recovering = false
}: {
  target: SendableTarget & { contactEmail: string };
  subject: string;
  body: string;
  fromEmail: string;
  messageId: string;
  replyToMessageId: string | undefined;
  outboundSendId: string;
  rawResult: Pick<SentMessageInfo, "accepted" | "rejected" | "response">;
  createFollowup: boolean;
  followupDays: number;
  sentAt?: string;
  recovering?: boolean;
}) {
  const sqlite = getSqlite();
  const now = sentAt ?? new Date().toISOString();
  const threadId = target.threadId ?? createId("thread");
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + followupDays);
  dueAt.setHours(9, 0, 0, 0);

  const transaction = sqlite.transaction(() => {
    if (!target.threadId) {
      sqlite
        .prepare(
          `
          INSERT INTO threads (
            id, target_id, contact_id, mailbox, subject, normalized_subject,
            first_message_id, last_message_id, last_inbound_at, last_outbound_at,
            next_followup_at, status, created_at, updated_at
          )
          VALUES (?, ?, ?, 'main', ?, ?, ?, ?, NULL, ?, ?, 'waiting', ?, ?)
        `
        )
        .run(
          threadId,
          target.id,
          target.contactId,
          subject,
          normalizeSubject(subject),
          messageId,
          messageId,
          now,
          createFollowup ? dueAt.toISOString() : null,
          now,
          now
        );
    } else if (recovering) {
      sqlite
        .prepare(
          `
          UPDATE threads
          SET last_message_id = CASE
                WHEN COALESCE(last_inbound_at, '') <= ? AND COALESCE(last_outbound_at, '') <= ?
                THEN ? ELSE last_message_id END,
              last_outbound_at = MAX(COALESCE(last_outbound_at, ''), ?),
              next_followup_at = (
                SELECT MIN(due_at) FROM followup_tasks
                WHERE thread_id = ? AND status = 'open' AND created_at > ?
              ),
              status = CASE WHEN updated_at <= ? THEN 'waiting' ELSE status END,
              updated_at = MAX(updated_at, ?)
          WHERE id = ?
        `
        )
        .run(now, now, messageId, now, threadId, now, now, now, threadId);
    } else {
      sqlite
        .prepare(
          `
          UPDATE threads
          SET last_message_id = ?,
              last_outbound_at = ?,
              next_followup_at = ?,
              status = 'waiting',
              updated_at = ?
          WHERE id = ?
        `
        )
        .run(
          messageId,
          now,
          createFollowup ? dueAt.toISOString() : null,
          now,
          threadId
        );
    }

    sqlite
      .prepare(
        `
        INSERT INTO messages (
          id, thread_id, direction, from_email, to_email, cc, bcc, subject,
          body_text, body_html, message_id, in_reply_to, references_header,
          sent_at, received_at, raw_headers_json, created_at
        )
        VALUES (?, ?, 'outbound', ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(message_id) DO NOTHING
      `
      )
      .run(
        createId("message"),
        threadId,
        fromEmail,
        target.contactEmail,
        subject,
        body,
        messageId,
        replyToMessageId ?? null,
        replyToMessageId ?? null,
        now,
        JSON.stringify({
          accepted: rawResult.accepted,
          rejected: rawResult.rejected,
          response: rawResult.response
        }),
        now
      );

    sqlite
      .prepare(
        "UPDATE targets SET status = 'sent', updated_at = ? WHERE id = ? AND (? = 0 OR updated_at <= ?)"
      )
      .run(now, target.id, Number(recovering), now);

    if (recovering) {
      sqlite
        .prepare(
          "DELETE FROM email_drafts WHERE target_id = ? AND updated_at <= ? AND subject = ? AND body = ?"
        )
        .run(target.id, now, subject, body);
    } else {
      clearEmailDraft(target.id);
    }

    sqlite
      .prepare(
        `
        UPDATE outbound_sends
        SET thread_id = ?,
            status = CASE WHEN ? = 1 THEN status ELSE 'sent' END,
            attempts = attempts + ?,
            sent_at = ?,
            last_error = NULL,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(threadId, Number(recovering), recovering ? 0 : 1, now, now, outboundSendId);

    const completedFollowups = sqlite
      .prepare(
        `
        UPDATE followup_tasks
        SET status = 'completed',
            completed_at = ?
        WHERE target_id = ?
          AND status = 'open'
          AND (? = 0 OR created_at <= ?)
      `
      )
      .run(now, target.id, Number(recovering), now).changes;

    if (createFollowup) {
      sqlite
        .prepare(
          `
          INSERT INTO followup_tasks (
            id, thread_id, target_id, due_at, status, suggested_subject,
            suggested_body, notification_sent_at, notification_channel,
            notification_status, completed_at, created_at
          )
          VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, NULL, NULL, NULL, ?)
        `
        )
        .run(
          createId("followup"),
          threadId,
          target.id,
          dueAt.toISOString(),
          subject.startsWith("Re:") ? subject : `Re: ${subject}`,
          body,
          now
        );
    }

    createTargetEvent(target.id, "email_sent", { from: fromEmail, messageId, subject }, now);

    if (completedFollowups > 0) {
      createTargetEvent(
        target.id,
        "followup_sent",
        { completedFollowups, messageId },
        now
      );
    }

    if (createFollowup) {
      createTargetEvent(target.id, "followup_scheduled", {
        dueAt: dueAt.toISOString(),
        followupDays
      });
    }

    if (recovering) {
      markSendRecordRecovered({
        outboundSendId,
        targetId: target.id,
        messageId,
        subject,
        resolution: "recovered_from_smtp_delivery",
        sentAt: now
      });
    }
  });

  transaction();
}

function createPendingOutboundSend({
  target,
  contactEmail,
  subject,
  body,
  fromEmail,
  messageId,
  sendKey
}: {
  target: SendableTarget;
  contactEmail: string;
  subject: string;
  body: string;
  fromEmail: string;
  messageId: string;
  sendKey: string;
}) {
  const now = new Date().toISOString();
  const outboundSendId = createId("outbound");
  const sqlite = getSqlite();
  const result = sqlite
    .prepare(
      `
      INSERT INTO outbound_sends (
        id, target_id, thread_id, to_email, subject, body_text, message_id, send_key,
        status, attempts, last_error, sent_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?)
      ON CONFLICT(send_key) DO NOTHING
    `
    )
    .run(
      outboundSendId,
      target.id,
      target.threadId,
      contactEmail,
      subject,
      body,
      messageId,
      sendKey,
      now,
      now
    );

  if (result.changes === 0) {
    const existing = sqlite
      .prepare("SELECT id FROM outbound_sends WHERE send_key = ?")
      .get(sendKey) as { id: string } | undefined;
    return { id: existing?.id ?? outboundSendId, inserted: false };
  }

  createTargetEvent(target.id, "send_queued", {
    outboundSendId,
    from: fromEmail,
    messageId,
    sendKey,
    subject
  });

  return { id: outboundSendId, inserted: true };
}

function markOutboundSendFailed(outboundSendId: string, error: string) {
  getSqlite()
    .prepare(
      "UPDATE outbound_sends SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?"
    )
    .run(error, new Date().toISOString(), outboundSendId);
}

function markOutboundSendPersistenceFailed(outboundSendId: string, error: string) {
  const now = new Date().toISOString();
  getSqlite()
    .prepare(
      "UPDATE outbound_sends SET status = 'smtp_accepted_persist_failed', attempts = attempts + 1, sent_at = ?, last_error = ?, updated_at = ? WHERE id = ?"
    )
    .run(now, error, now, outboundSendId);
}

export function createLocalMessageId(fromEmail: string) {
  const domain = getMessageIdDomain(fromEmail);
  return `<${createId("message")}@${domain}>`;
}

export function createTargetEvent(
  targetId: string,
  eventType: string,
  payload: Record<string, unknown>,
  createdAt = new Date().toISOString()
) {
  getSqlite()
    .prepare(
      "INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, 'target', ?, ?, ?, ?)"
    )
    .run(createId("event"), targetId, eventType, JSON.stringify(payload), createdAt);
}

function getSendBlockedMessage(target: SendableTarget) {
  if (!target.contactEmail) return "This target has no email address.";
  if (isDoNotResendHardBlock(target))
    return "This target is marked Do Not Resend and is not an active/replied thread.";
  if (isSendBlockedStatus(target.status)) return "This target status blocks sending.";
  if (isNonActionablePlatformTarget(target))
    return "This platform target is marked non-actionable.";
  if (isEmailVerificationBlocking(target.emailVerificationStatus))
    return `Email verification blocks sending: ${target.emailVerificationStatus ?? "bad email"}.`;
  return "ReachLog blocked this send.";
}
