import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";

/**
 * Helpers for messages SMTP accepted while the matching local record could not
 * be written. SMTP already accepted the email, so recovery only reconstructs
 * local history and never talks to the mail server again.
 */
export type UnsavedAcceptedSend = {
  id: string;
  targetId: string;
  threadId: string | null;
  toEmail: string;
  subject: string;
  bodyText: string;
  messageId: string;
  sentAt: string | null;
  createdAt: string;
};

export type SendRecoveryResolution =
  | "recovered_from_smtp_delivery"
  | "message_already_saved";

export function getUnsavedAcceptedSend(
  outboundSendId: string,
  targetId: string
): UnsavedAcceptedSend | undefined {
  return getSqlite()
    .prepare(
      `
      SELECT
        id,
        target_id as targetId,
        thread_id as threadId,
        to_email as toEmail,
        subject,
        body_text as bodyText,
        message_id as messageId,
        sent_at as sentAt,
        created_at as createdAt
      FROM outbound_sends
      WHERE id = ?
        AND target_id = ?
        AND status = 'smtp_accepted_persist_failed'
    `
    )
    .get(outboundSendId, targetId) as UnsavedAcceptedSend | undefined;
}

export function hasUnsavedAcceptedSend(targetId: string) {
  return Boolean(
    getSqlite()
      .prepare(
        `SELECT 1 FROM outbound_sends
         WHERE status = 'smtp_accepted_persist_failed'
           AND (target_id = ? OR lower(to_email) = (
             SELECT lower(contacts.email) FROM targets
             JOIN contacts ON contacts.id = targets.contact_id WHERE targets.id = ?
           ))
         LIMIT 1`
      )
      .get(targetId, targetId)
  );
}

export function messageRecordExists(messageId: string) {
  return Boolean(
    getSqlite().prepare("SELECT 1 FROM messages WHERE message_id = ?").get(messageId)
  );
}

export function recoverSenderAddress(targetId: string, outboundSendId: string) {
  const rows = getSqlite()
    .prepare(
      `
      SELECT payload_json as payloadJson
      FROM events
      WHERE entity_type = 'target'
        AND entity_id = ?
        AND event_type = 'send_queued'
      ORDER BY created_at DESC
    `
    )
    .all(targetId) as Array<{ payloadJson: string | null }>;

  for (const row of rows) {
    if (!row.payloadJson) {
      continue;
    }

    try {
      const payload = JSON.parse(row.payloadJson) as {
        outboundSendId?: string;
        from?: string;
      };

      if (payload.outboundSendId === outboundSendId && typeof payload.from === "string" && payload.from.trim()) {
        return payload.from;
      }
    } catch {
      // Ignore audit rows that cannot be parsed and keep looking.
    }
  }

  return null;
}

export function markSendRecordRecovered({
  outboundSendId,
  targetId,
  messageId,
  subject,
  resolution,
  sentAt
}: {
  outboundSendId: string;
  targetId: string;
  messageId: string;
  subject: string;
  resolution: SendRecoveryResolution;
  sentAt?: string | null;
}) {
  const sqlite = getSqlite();
  const now = new Date().toISOString();

  sqlite.transaction(() => {
    const result = sqlite
      .prepare(
        `
        UPDATE outbound_sends
        SET status = 'sent',
            thread_id = (SELECT thread_id FROM messages WHERE message_id = ?),
            last_error = NULL,
            sent_at = COALESCE(sent_at, ?),
            updated_at = ?
        WHERE id = ?
          AND target_id = ?
          AND status = 'smtp_accepted_persist_failed'
      `
      )
      .run(messageId, sentAt ?? now, now, outboundSendId, targetId);

    if (!result.changes) return;

    sqlite
      .prepare(
        "INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, 'target', ?, 'send_record_recovered', ?, ?)"
      )
      .run(
        createId("event"),
        targetId,
        JSON.stringify({ outboundSendId, messageId, subject, resolution }),
        now
      );
  })();
}
