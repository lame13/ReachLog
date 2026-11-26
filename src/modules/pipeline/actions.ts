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
    .prepare(
      "SELECT stage, status, do_not_resend as doNotResend, closed_at as closedAt FROM targets WHERE id = ?"
    )
    .get(targetId) as
    | {
        stage: string;
        status: string;
        doNotResend: number;
        closedAt: string | null;
      }
    | undefined;

  if (!current) {
    return;
  }

  const previousStage = getPipelineStage(current.stage).key;

  if (previousStage === stage) {
    return;
  }

  const now = new Date().toISOString();
  const status = statusForStageMove(current.status, stage, current.doNotResend);
  const closedAt =
    stage === "won" || stage === "lost" ? current.closedAt ?? now : null;

  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare(
        `
        UPDATE targets
        SET stage = ?,
            status = ?,
            closed_at = ?,
            lost_reason = CASE WHEN ? = 'lost' THEN lost_reason ELSE NULL END,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(stage, status, closedAt, stage, now, targetId);

    if (stage === "won" || stage === "lost") {
      // Closed opportunities keep their outreach history but stop queueing
      // reminders. Reopening a record can create a new next step.
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
        status,
        closedAt
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
