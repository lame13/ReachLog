"use server";

import { revalidatePath } from "next/cache";
import { getSqlite } from "@/modules/core/db/client";
import {
  getPipelineStage,
  isPipelineStage,
  statusForStageMove
} from "@/modules/pipeline/stages";
import { recordEvent } from "@/modules/timeline/record";

/**
 * Moving a card is the core pipeline action. It writes the stage, keeps the
 * free-text outreach status in step so tables and analytics do not disagree
 * with the board, and records the move on the timeline.
 */
export async function moveTargetStageAction(formData: FormData) {
  const targetId = clean(formData.get("targetId"));
  const stage = clean(formData.get("stage"));

  if (!targetId || !isPipelineStage(stage)) {
    return;
  }

  const sqlite = getSqlite();
  const current = sqlite
    .prepare("SELECT stage, status, do_not_resend as doNotResend FROM targets WHERE id = ?")
    .get(targetId) as { stage: string; status: string; doNotResend: number } | undefined;

  if (!current) {
    return;
  }

  const previousStage = getPipelineStage(current.stage).key;

  if (previousStage === stage) {
    return;
  }

  const now = new Date().toISOString();
  const status = statusForStageMove(current.status, stage, current.doNotResend);

  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare("UPDATE targets SET stage = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(stage, status, now, targetId);

    if (stage === "lost") {
      // A closed-lost target keeps its outreach history but stops queueing
      // reminders, exactly as marking it dead did before stages existed.
      sqlite
        .prepare(
          `
          UPDATE followup_tasks
          SET status = 'cancelled',
              completed_at = ?
          WHERE target_id = ?
            AND status = 'open'
        `
        )
        .run(now, targetId);
    }

    recordEvent({
      entityType: "target",
      entityId: targetId,
      eventType: "stage_changed",
      payload: {
        stage,
        previousStage,
        previousStatus: current.status,
        status
      }
    });
  });

  transaction();
  revalidatePipeline(targetId);
}

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function revalidatePipeline(targetId: string) {
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/targets");
  revalidatePath(`/targets/${targetId}`);
  revalidatePath("/analytics");
}
