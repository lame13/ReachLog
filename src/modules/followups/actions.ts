"use server";

import { revalidatePath } from "next/cache";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";

export async function snoozeFollowupAction(formData: FormData) {
  const followupId = String(formData.get("followupId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  const days = Number(formData.get("days") ?? 3);

  if (!followupId || !targetId) {
    return;
  }

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + days);
  dueAt.setHours(9, 0, 0, 0);

  const sqlite = getSqlite();
  const now = new Date().toISOString();

  sqlite
    .prepare(
      "UPDATE followup_tasks SET due_at = ?, notification_sent_at = NULL, notification_channel = NULL, notification_status = NULL WHERE id = ?"
    )
    .run(dueAt.toISOString(), followupId);

  sqlite
    .prepare(
      "INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, 'target', ?, 'followup_snoozed', ?, ?)"
    )
    .run(createId("event"), targetId, JSON.stringify({ days, followupId }), now);

  revalidatePath("/dashboard");
  revalidatePath("/followups");
  revalidatePath(`/targets/${targetId}`);
}

export async function markDeadAction(formData: FormData) {
  const followupId = String(formData.get("followupId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");

  if (!followupId || !targetId) {
    return;
  }

  const sqlite = getSqlite();
  const now = new Date().toISOString();

  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare(
        "UPDATE followup_tasks SET status = 'completed', completed_at = ? WHERE id = ?"
      )
      .run(now, followupId);

    sqlite
      .prepare("UPDATE targets SET status = 'dead', updated_at = ? WHERE id = ?")
      .run(now, targetId);

    sqlite
      .prepare(
        "INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, 'target', ?, 'dead', ?, ?)"
      )
      .run(createId("event"), targetId, JSON.stringify({ followupId }), now);
  });

  transaction();

  revalidatePath("/dashboard");
  revalidatePath("/followups");
  revalidatePath(`/targets/${targetId}`);
}
