"use server";

import nodemailer from "nodemailer";
import { revalidatePath } from "next/cache";
import { env } from "@/modules/core/env";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import { normalizeSubject } from "@/modules/mailbox/threading";

export async function saveDraftAction(formData: FormData) {
  const targetId = String(formData.get("targetId") ?? "");
  const subject = String(formData.get("subject") ?? "");
  const body = String(formData.get("body") ?? "");

  if (!targetId || !subject || !body) {
    return;
  }

  createTargetEvent(targetId, "draft_saved", { subject, bodyLength: body.length });
  revalidatePath(`/targets/${targetId}`);
}

export async function sendNowAction(formData: FormData) {
  const targetId = String(formData.get("targetId") ?? "");
  const subject = String(formData.get("subject") ?? "");
  const body = String(formData.get("body") ?? "");
  const createFollowup = formData.get("createFollowup") === "on";
  const followupDays = Math.max(1, Number(formData.get("followupDays") ?? 3));

  if (!targetId || !subject || !body) {
    return;
  }

  const target = getSendableTarget(targetId);

  if (!target?.contactEmail || target.doNotResend) {
    createTargetEvent(targetId, "send_blocked", {
      reason: target?.doNotResend ? "do_not_resend" : "missing_contact_email",
      subject
    });
    revalidateAfterSend(targetId);
    return;
  }

  const contactEmail = target.contactEmail;
  const messageId = createLocalMessageId();

  if (!env.SMTP_ENABLED) {
    createTargetEvent(targetId, "send_blocked", {
      reason: "smtp_disabled",
      subject
    });
    revalidateAfterSend(targetId);
    return;
  }

  const outboundSendId = createPendingOutboundSend({
    target,
    contactEmail,
    subject,
    body,
    messageId
  });

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS
          }
        : undefined
  });

  try {
    const result = await transporter.sendMail({
      from: getFromEmail(),
      to: target.contactEmail,
      subject,
      text: body,
      messageId
    });

    persistSentEmail({
      target: { ...target, contactEmail },
      subject,
      body,
      messageId,
      outboundSendId,
      rawResult: result,
      createFollowup,
      followupDays
    });
  } catch (error) {
    markOutboundSendFailed(
      outboundSendId,
      error instanceof Error ? error.message : "unknown_error"
    );
    createTargetEvent(targetId, "send_failed", {
      messageId,
      subject,
      error: error instanceof Error ? error.message : "unknown_error"
    });
    revalidateAfterSend(targetId);
    throw error;
  }

  revalidateAfterSend(targetId);
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
  doNotResend: number;
  threadId: string | null;
  threadSubject: string | null;
  firstMessageId: string | null;
};

function getSendableTarget(targetId: string) {
  return getSqlite()
    .prepare(
      `
      SELECT
        targets.id,
        targets.contact_id as contactId,
        targets.company_name as companyName,
        targets.do_not_resend as doNotResend,
        contacts.email as contactEmail,
        threads.id as threadId,
        threads.subject as threadSubject,
        threads.first_message_id as firstMessageId
      FROM targets
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      LEFT JOIN threads ON threads.target_id = targets.id
      WHERE targets.id = ?
      ORDER BY threads.updated_at DESC
      LIMIT 1
    `
    )
    .get(targetId) as SendableTarget | undefined;
}

function persistSentEmail({
  target,
  subject,
  body,
  messageId,
  outboundSendId,
  rawResult,
  createFollowup,
  followupDays
}: {
  target: SendableTarget & { contactEmail: string };
  subject: string;
  body: string;
  messageId: string;
  outboundSendId: string;
  rawResult: nodemailer.SentMessageInfo;
  createFollowup: boolean;
  followupDays: number;
}) {
  const sqlite = getSqlite();
  const now = new Date().toISOString();
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
      `
      )
      .run(
        createId("message"),
        threadId,
        getFromEmail(),
        target.contactEmail,
        subject,
        body,
        messageId,
        target.firstMessageId,
        target.firstMessageId,
        now,
        JSON.stringify({
          accepted: rawResult.accepted,
          rejected: rawResult.rejected,
          response: rawResult.response
        }),
        now
      );

    sqlite
      .prepare("UPDATE targets SET status = 'sent', updated_at = ? WHERE id = ?")
      .run(now, target.id);

    sqlite
      .prepare(
        `
        UPDATE outbound_sends
        SET thread_id = ?,
            status = 'sent',
            attempts = attempts + 1,
            sent_at = ?,
            last_error = NULL,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(threadId, now, now, outboundSendId);

    const completedFollowups = sqlite
      .prepare(
        `
        UPDATE followup_tasks
        SET status = 'completed',
            completed_at = ?
        WHERE target_id = ?
          AND status = 'open'
      `
      )
      .run(now, target.id).changes;

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
          "Hi, just wanted to follow up on this.",
          now
        );
    }

    createTargetEvent(target.id, "email_sent", {
      messageId,
      subject
    });

    if (completedFollowups > 0) {
      createTargetEvent(target.id, "followup_sent", {
        completedFollowups,
        messageId
      });
    }

    if (createFollowup) {
      createTargetEvent(target.id, "followup_scheduled", {
        dueAt: dueAt.toISOString(),
        followupDays
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
  messageId
}: {
  target: SendableTarget;
  contactEmail: string;
  subject: string;
  body: string;
  messageId: string;
}) {
  const now = new Date().toISOString();
  const outboundSendId = createId("outbound");

  getSqlite()
    .prepare(
      `
      INSERT INTO outbound_sends (
        id, target_id, thread_id, to_email, subject, body_text, message_id,
        status, attempts, last_error, sent_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?)
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
      now,
      now
    );

  createTargetEvent(target.id, "send_queued", {
    outboundSendId,
    messageId,
    subject
  });

  return outboundSendId;
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

function getFromEmail() {
  return env.SMTP_FROM || env.SMTP_USER || "me@example.local";
}

function createLocalMessageId() {
  const domain = getFromEmail().split("@")[1] || "reachlog.local";
  return `<${createId("message")}@${domain}>`;
}

function createTargetEvent(
  targetId: string,
  eventType: string,
  payload: Record<string, unknown>
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
      new Date().toISOString()
    );
}
