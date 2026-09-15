"use server";

import nodemailer, { type SentMessageInfo } from "nodemailer";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { env } from "@/modules/core/env";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import { clearEmailDraft, saveEmailDraft } from "./drafts";
import { smtpTransportOptions } from "./transport";
import { unresolvedVariables } from "../templates/render";
import { normalizeSubject } from "@/modules/mailbox/threading";
import {
  isDoNotResendHardBlock,
  isNonActionablePlatformTarget,
  isSendBlockedStatus,
  isTargetActionBlocked
} from "@/modules/outreach/status";
import { isEmailVerificationBlocking } from "@/modules/emailVerification/service";
import {
  getMessageIdDomain,
  selectSmtpIdentity
} from "@/modules/smtp/from-identities";
import {
  getUnsavedAcceptedSend,
  hasUnsavedAcceptedSend,
  markSendRecordRecovered,
  messageRecordExists,
  recoverSenderAddress
} from "./recover-send";

export async function saveDraftAction(formData: FormData) {
  const targetId = String(formData.get("targetId") ?? "");
  const subject = String(formData.get("subject") ?? "");
  const body = String(formData.get("body") ?? "");

  if (!targetId || !subject || !body) {
    return;
  }

  if (!getSendableTarget(targetId)) return;
  const fromEmail = selectSmtpIdentity(String(formData.get("fromEmail") ?? "")).value;
  saveEmailDraft(targetId, { subject, body, fromEmail });
  createTargetEvent(targetId, "draft_saved", { subject, bodyLength: body.length });
  revalidatePath(`/targets/${targetId}`);
  redirectWithSendFeedback(
    getSafeReturnTo(String(formData.get("returnTo") ?? "")),
    targetId, "success", "Draft saved. Nothing was sent."
  );
}

export async function sendNowAction(formData: FormData) {
  const targetId = String(formData.get("targetId") ?? "");
  const subject = String(formData.get("subject") ?? "");
  const body = String(formData.get("body") ?? "");
  const fromIdentity = selectSmtpIdentity(String(formData.get("fromEmail") ?? ""));
  const fromEmail = fromIdentity.from;
  const sendKey =
    String(formData.get("sendKey") ?? "").trim() || createId("sendkey");
  const returnTo = getSafeReturnTo(String(formData.get("returnTo") ?? ""));
  const createFollowup = formData.get("createFollowup") === "on";
  const followupDays = Math.max(1, Number(formData.get("followupDays") ?? 5));

  if (!targetId || !subject || !body) {
    redirectWithSendFeedback(
      returnTo,
      targetId,
      "error",
      "Subject and body are required before sending."
    );
  }

  const target = getSendableTarget(targetId);

  if (unresolvedVariables(subject + "\n" + body).length || subject.length > 300 || body.length > 50000 || /[\r\n]/.test(subject)) {
    if (target) saveEmailDraft(targetId, { subject, body, fromEmail: fromIdentity.value });
    redirectWithSendFeedback(returnTo, targetId, "error", "Check the subject and message length, and replace all template variables before sending. Your draft was saved.");
  }

  const blockedStatus = isSendBlockedStatus(target?.status);
  const blockedPlatform = target ? isNonActionablePlatformTarget(target) : false;
  const blockedDoNotResend = target ? isDoNotResendHardBlock(target) : false;
  const blockedTarget = target ? isTargetActionBlocked(target) : false;
  const blockedEmailVerification = isEmailVerificationBlocking(
    target?.emailVerificationStatus
  );

  if (
    !target?.contactEmail ||
    blockedTarget ||
    blockedEmailVerification
  ) {
    createTargetEvent(targetId, "send_blocked", {
      reason: blockedDoNotResend
        ? "do_not_resend"
        : blockedStatus
          ? "blocked_status"
          : blockedPlatform
            ? "non_actionable_platform"
            : blockedEmailVerification
              ? "email_verification_blocked"
              : "missing_contact_email",
      status: target?.status,
      emailVerificationStatus: target?.emailVerificationStatus,
      subject
    });
    revalidateAfterSend(targetId);
    redirectWithSendFeedback(
      returnTo,
      targetId,
      "error",
      getSendBlockedMessage({
        hasContactEmail: Boolean(target?.contactEmail),
        doNotResend: blockedDoNotResend,
        blockedStatus,
        blockedPlatform,
        blockedEmailVerification,
        emailVerificationStatus: target?.emailVerificationStatus
      })
    );
  }

  if (hasUnsavedAcceptedSend(targetId)) {
    createTargetEvent(targetId, "send_blocked", {
      reason: "unsaved_accepted_send",
      subject
    });
    revalidateAfterSend(targetId);
    redirectWithSendFeedback(
      returnTo,
      targetId,
      "error",
      "An earlier email to this contact was accepted by your mail server but is not in your history yet. Open Sending needs review on the dashboard to save it or mark it checked before sending again."
    );
  }

  const contactEmail = target.contactEmail;
  const messageId = createLocalMessageId(fromEmail);
  const replyToMessageId = target.lastMessageId ?? target.firstMessageId ?? undefined;

  if (env.DEMO_MODE) {
    const outboundSendId = createPendingOutboundSend({
      target,
      contactEmail,
      subject,
      body,
      fromEmail,
      messageId,
      sendKey
    });

    if (!outboundSendId.inserted) {
      createTargetEvent(targetId, "send_duplicate_blocked", {
        sendKey,
        outboundSendId: outboundSendId.id,
        subject,
        demoMode: true
      });
      revalidateAfterSend(targetId);
      redirectWithSendFeedback(
        returnTo,
        targetId,
        "info",
        "This send was already submitted. Duplicate send was blocked."
      );
    }

    persistSentEmail({
      target: { ...target, contactEmail },
      subject,
      body,
      fromEmail,
      messageId,
      replyToMessageId,
      outboundSendId: outboundSendId.id,
      rawResult: {
        accepted: [contactEmail],
        rejected: [],
        response: "demo_mode"
      },
      createFollowup,
      followupDays
    });
    createTargetEvent(targetId, "demo_email_simulated", {
      from: fromEmail,
      to: contactEmail,
      messageId,
      subject
    });
    revalidateAfterSend(targetId);
    redirectWithSendFeedback(
      returnTo,
      targetId,
      "success",
      "Demo mode: email send was simulated. Nothing was sent."
    );
  }

  if (!env.SMTP_ENABLED) {
    createTargetEvent(targetId, "send_blocked", {
      reason: "smtp_disabled",
      subject
    });
    revalidateAfterSend(targetId);
    redirectWithSendFeedback(
      returnTo,
      targetId,
      "error",
      "Email sending is off. Connect and enable your SMTP account in Settings."
    );
  }

  const outboundSendId = createPendingOutboundSend({
    target,
    contactEmail,
    subject,
    body,
    fromEmail,
    messageId,
    sendKey
  });

  if (!outboundSendId.inserted) {
    createTargetEvent(targetId, "send_duplicate_blocked", {
      sendKey,
      outboundSendId: outboundSendId.id,
      subject
    });
    revalidateAfterSend(targetId);
    redirectWithSendFeedback(
      returnTo,
      targetId,
      "info",
      "This send was already submitted. Duplicate send was blocked."
    );
  }

  const transporter = nodemailer.createTransport(smtpTransportOptions({ user: fromIdentity.smtpUser, pass: fromIdentity.smtpPass }));

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
    markOutboundSendFailed(
      outboundSendId.id,
      error instanceof Error ? error.message : "unknown_error"
    );
    createTargetEvent(targetId, "send_failed", {
      messageId,
      subject,
      error: error instanceof Error ? error.message : "unknown_error"
    });
    revalidateAfterSend(targetId);
    redirectWithSendFeedback(
      returnTo,
      targetId,
      "error",
      `SMTP send failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  try {
    persistSentEmail({
      target: { ...target, contactEmail },
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
    markOutboundSendPersistenceFailed(
      outboundSendId.id,
      error instanceof Error ? error.message : "unknown_error"
    );
    createTargetEvent(targetId, "send_persist_failed_after_smtp_accept", {
      messageId,
      subject,
      error: error instanceof Error ? error.message : "unknown_error"
    });
    revalidateAfterSend(targetId);
    redirectWithSendFeedback(
      returnTo,
      targetId,
      "error",
      `SMTP accepted the email, but ReachLog failed to save it. Do not resend until checked. ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }

  revalidateAfterSend(targetId);
  redirect(returnTo || `/targets/${targetId}`);
}

function revalidateAfterSend(targetId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/followups");
  revalidatePath("/targets");
  revalidatePath(`/targets/${targetId}`);
  revalidatePath("/analytics");
}

type SendableTarget = {
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

function getSendableTarget(targetId: string, threadId: string | null = null) {
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

function persistSentEmail({
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
      // Backfilling history must not rewind a newer reply or follow-up.
      sqlite.prepare(`
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
      `).run(now, now, messageId, now, threadId, now, now, now, threadId);
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
      .prepare("UPDATE targets SET status = 'sent', updated_at = ? WHERE id = ? AND (? = 0 OR updated_at <= ?)")
      .run(now, target.id, Number(recovering), now);

    if (recovering) {
      sqlite.prepare("DELETE FROM email_drafts WHERE target_id = ? AND updated_at <= ? AND subject = ? AND body = ?")
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

    createTargetEvent(target.id, "email_sent", {
      from: fromEmail,
      messageId,
      subject
    }, now);

    if (completedFollowups > 0) {
      createTargetEvent(target.id, "followup_sent", {
        completedFollowups,
        messageId
      }, now);
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

    return {
      id: existing?.id ?? outboundSendId,
      inserted: false
    };
  }

  createTargetEvent(target.id, "send_queued", {
    outboundSendId,
    from: fromEmail,
    messageId,
    sendKey,
    subject
  });

  return {
    id: outboundSendId,
    inserted: true
  };
}

function markOutboundSendFailed(outboundSendId: string, error: string) {
  getSqlite()
    .prepare(
      `
      UPDATE outbound_sends
      SET status = 'failed',
          attempts = attempts + 1,
          last_error = ?,
          updated_at = ?
      WHERE id = ?
    `
    )
    .run(error, new Date().toISOString(), outboundSendId);
}

function markOutboundSendPersistenceFailed(outboundSendId: string, error: string) {
  const now = new Date().toISOString();

  getSqlite()
    .prepare(
      `
      UPDATE outbound_sends
      SET status = 'smtp_accepted_persist_failed',
          attempts = attempts + 1,
          sent_at = ?,
          last_error = ?,
          updated_at = ?
      WHERE id = ?
    `
    )
    .run(now, error, now, outboundSendId);
}

function getSafeReturnTo(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "";
  }

  return value;
}

function redirectWithSendFeedback(
  returnTo: string,
  targetId: string,
  status: "error" | "info" | "success",
  message: string
): never {
  const fallback = targetId ? `/targets/${targetId}` : "/dashboard";
  const url = new URL(returnTo || fallback, "https://reachlog.local");

  if (targetId) {
    url.searchParams.set("sendTargetId", targetId);
  }

  url.searchParams.set("sendStatus", status);
  url.searchParams.set("sendMessage", message.slice(0, 700));

  redirect(`${url.pathname}${url.search}`);
}

function getSendBlockedMessage({
  hasContactEmail,
  doNotResend,
  blockedStatus,
  blockedPlatform,
  blockedEmailVerification,
  emailVerificationStatus
}: {
  hasContactEmail: boolean;
  doNotResend: boolean;
  blockedStatus: boolean;
  blockedPlatform: boolean;
  blockedEmailVerification: boolean;
  emailVerificationStatus: string | null | undefined;
}) {
  if (!hasContactEmail) {
    return "This target has no email address.";
  }

  if (doNotResend) {
    return "This target is marked Do Not Resend and is not an active/replied thread.";
  }

  if (blockedStatus) {
    return "This target status blocks sending.";
  }

  if (blockedPlatform) {
    return "This platform target is marked non-actionable.";
  }

  if (blockedEmailVerification) {
    return `Email verification blocks sending: ${emailVerificationStatus ?? "bad email"}.`;
  }

  return "ReachLog blocked this send.";
}

function createLocalMessageId(fromEmail: string) {
  const domain = getMessageIdDomain(fromEmail);
  return `<${createId("message")}@${domain}>`;
}

function createTargetEvent(
  targetId: string,
  eventType: string,
  payload: Record<string, unknown>,
  createdAt = new Date().toISOString()
) {
  getSqlite()
    .prepare(
      "INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, 'target', ?, ?, ?, ?)"
    )
    .run(
      createId("event"),
      targetId,
      eventType,
      JSON.stringify(payload),
      createdAt
    );
}

/**
 * Stores a message SMTP already accepted when writing its local record failed.
 * The email is not sent again, and no new follow-up is scheduled.
 */
export async function completeAcceptedSendAction(formData: FormData) {
  const outboundSendId = String(formData.get("outboundSendId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  const send =
    outboundSendId && targetId
      ? getUnsavedAcceptedSend(outboundSendId, targetId)
      : undefined;

  if (!send) {
    redirectWithDashboardFeedback(
      "info",
      "That send is already resolved or no longer waiting for a saved record."
    );
  }

  if (messageRecordExists(send.messageId)) {
    markSendRecordRecovered({
      outboundSendId: send.id,
      targetId: send.targetId,
      messageId: send.messageId,
      subject: send.subject,
      resolution: "message_already_saved",
      sentAt: send.sentAt
    });
    revalidateAfterSend(send.targetId);
    redirectWithDashboardFeedback(
      "success",
      "That email was already in your history. Nothing was sent again."
    );
  }

  const target = getSendableTarget(send.targetId, send.threadId);

  if (!target) {
    redirectWithDashboardFeedback(
      "error",
      "ReachLog could not find the contact for this send."
    );
  }

  const fromEmail = recoverSenderAddress(send.targetId, send.id);
  if (!fromEmail) {
    redirectWithDashboardFeedback("error", "The original sender is missing from the send history. Check the email in your mailbox before marking it checked.");
  }
  const sentAt = send.sentAt ?? send.createdAt;
  const previousMessage = getSqlite().prepare(`
    SELECT message_id AS messageId FROM messages
    WHERE thread_id = ? AND COALESCE(sent_at, received_at, created_at) <= ?
    ORDER BY COALESCE(sent_at, received_at, created_at) DESC LIMIT 1
  `).get(target.threadId, sentAt) as { messageId: string } | undefined;

  try {
    persistSentEmail({
      target: { ...target, contactEmail: send.toEmail },
      subject: send.subject,
      body: send.bodyText,
      fromEmail,
      messageId: send.messageId,
      replyToMessageId: previousMessage?.messageId,
      outboundSendId: send.id,
      rawResult: {
        accepted: [send.toEmail],
        rejected: [],
        response: "recovered_after_persist_failure"
      },
      createFollowup: false,
      followupDays: 0,
      sentAt,
      recovering: true
    });
  } catch (error) {
    createTargetEvent(send.targetId, "send_record_recovery_failed", {
      messageId: send.messageId,
      error: error instanceof Error ? error.message : "unknown_error"
    });
    revalidateAfterSend(send.targetId);
    redirectWithDashboardFeedback(
      "error",
      `ReachLog could not save the record: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }

  revalidateAfterSend(send.targetId);
  redirectWithDashboardFeedback(
    "success",
    "Saved the accepted email to the contact history. Nothing was sent again. Add a follow-up if you still need one."
  );
}

function redirectWithDashboardFeedback(
  status: "error" | "info" | "success",
  message: string
): never {
  const url = new URL("/dashboard", "https://reachlog.local");
  url.searchParams.set("sendStatus", status);
  url.searchParams.set("sendMessage", message.slice(0, 700));
  redirect(`${url.pathname}${url.search}`);
}
