"use server";

import { revalidatePath } from "next/cache";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";

export async function resolveSendAnomalyAction(formData: FormData) {
  const outboundSendId = String(formData.get("outboundSendId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");

  if (!outboundSendId || !targetId) {
    return;
  }

  const sqlite = getSqlite();
  const now = new Date().toISOString();

  const send = sqlite
    .prepare(
      `
      SELECT
        id,
        target_id as targetId,
        subject,
        message_id as messageId,
        status,
        last_error as lastError
      FROM outbound_sends
      WHERE id = ?
        AND target_id = ?
        AND status IN ('failed', 'smtp_accepted_persist_failed')
    `
    )
    .get(outboundSendId, targetId) as
    | {
        id: string;
        targetId: string;
        subject: string;
        messageId: string;
        status: string;
        lastError: string | null;
      }
    | undefined;

  if (!send) {
    return;
  }

  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare(
        `
        UPDATE outbound_sends
        SET status = 'manually_resolved',
            last_error = NULL,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(now, outboundSendId);

    sqlite
      .prepare(
        `
        INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at)
        VALUES (?, 'target', ?, 'send_anomaly_resolved', ?, ?)
      `
      )
      .run(
        createId("event"),
        targetId,
        JSON.stringify({
          outboundSendId,
          messageId: send.messageId,
          subject: send.subject,
          previousStatus: send.status,
          previousError: send.lastError,
          resolution:
            send.status === "failed"
              ? "manual_review_send_failed"
              : "manual_confirmed_already_sent"
        }),
        now
      );
  });

  transaction();
  revalidatePath("/dashboard");
  revalidatePath(`/targets/${targetId}`);
  revalidatePath("/analytics");
}
