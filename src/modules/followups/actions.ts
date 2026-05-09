"use server";

import { revalidatePath } from "next/cache";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";

export async function createFollowupAction(formData: FormData) {
  const targetId = String(formData.get("targetId") ?? "");
  const threadId = String(formData.get("threadId") ?? "") || null;
  const dueDate = String(formData.get("dueDate") ?? "");
  const dueTime = String(formData.get("dueTime") ?? "09:00");
  const suggestedSubject = String(formData.get("suggestedSubject") ?? "").trim();
  const suggestedBody = String(formData.get("suggestedBody") ?? "").trim();

  if (!targetId || !dueDate) {
    return;
  }

  const dueAt = new Date(`${dueDate}T${dueTime || "09:00"}:00`);

  if (Number.isNaN(dueAt.getTime())) {
    return;
  }

  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const dueAtIso = dueAt.toISOString();
  const followupId = createId("followup");

  const transaction = sqlite.transaction(() => {
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
        followupId,
        threadId,
        targetId,
        dueAtIso,
        suggestedSubject || null,
        suggestedBody || null,
        now
      );

    if (threadId) {
      sqlite
        .prepare(
          "UPDATE threads SET next_followup_at = ?, updated_at = ? WHERE id = ?"
        )
        .run(dueAtIso, now, threadId);
    }

    sqlite
      .prepare(
        "UPDATE targets SET status = 'follow-up due', updated_at = ? WHERE id = ?"
      )
      .run(now, targetId);

    sqlite
      .prepare(
        "INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, 'target', ?, 'followup_created', ?, ?)"
      )
      .run(
        createId("event"),
        targetId,
        JSON.stringify({ followupId, threadId, dueAt: dueAtIso }),
        now
      );
  });

  transaction();
  revalidateFollowupPaths(targetId);
}

export async function completeFollowupAction(formData: FormData) {
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
      .prepare(
        "INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, 'target', ?, 'followup_completed', ?, ?)"
      )
      .run(createId("event"), targetId, JSON.stringify({ followupId }), now);
  });

  transaction();
  revalidateFollowupPaths(targetId);
}

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
  revalidatePath("/analytics");
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
        `
        UPDATE followup_tasks
        SET status = CASE WHEN id = ? THEN 'completed' ELSE 'cancelled' END,
            completed_at = ?
        WHERE target_id = ?
          AND status = 'open'
      `
      )
      .run(followupId, now, targetId);

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
  revalidatePath("/analytics");
}

function revalidateFollowupPaths(targetId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/followups");
  revalidatePath(`/targets/${targetId}`);
  revalidatePath("/analytics");
}
