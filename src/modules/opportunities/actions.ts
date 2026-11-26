"use server";

import { revalidatePath } from "next/cache";
import { getSqlite } from "@/modules/core/db/client";
import { recordEvent } from "@/modules/timeline/record";
import { dateAtNine } from "./value";

export async function scheduleNextStepAction(formData: FormData) {
  const targetId = clean(formData.get("targetId"));
  const nextStep = clean(formData.get("nextStep"));
  const nextStepDate = clean(formData.get("nextStepDate"));

  if (!targetId || !nextStep) {
    return;
  }

  const nextStepAt = dateAtNine(nextStepDate);
  const now = new Date().toISOString();
  const sqlite = getSqlite();
  const target = sqlite
    .prepare("SELECT next_step as nextStep, next_step_at as nextStepAt FROM targets WHERE id = ?")
    .get(targetId) as { nextStep: string | null; nextStepAt: string | null } | undefined;

  if (!target) {
    return;
  }

  sqlite
    .prepare(
      "UPDATE targets SET next_step = ?, next_step_at = ?, updated_at = ? WHERE id = ?"
    )
    .run(nextStep, nextStepAt, now, targetId);

  recordEvent({
    entityType: "target",
    entityId: targetId,
    eventType: "next_step_scheduled",
    payload: {
      nextStep,
      nextStepAt,
      previousNextStep: target.nextStep,
      previousNextStepAt: target.nextStepAt
    }
  });
  revalidateOpportunityPaths(targetId);
}

export async function completeNextStepAction(formData: FormData) {
  const targetId = clean(formData.get("targetId"));

  if (!targetId) {
    return;
  }

  const sqlite = getSqlite();
  const target = sqlite
    .prepare("SELECT next_step as nextStep, next_step_at as nextStepAt FROM targets WHERE id = ?")
    .get(targetId) as { nextStep: string | null; nextStepAt: string | null } | undefined;

  if (!target?.nextStep) {
    return;
  }

  const now = new Date().toISOString();
  sqlite
    .prepare(
      "UPDATE targets SET next_step = NULL, next_step_at = NULL, updated_at = ? WHERE id = ?"
    )
    .run(now, targetId);

  recordEvent({
    entityType: "target",
    entityId: targetId,
    eventType: "next_step_completed",
    payload: {
      nextStep: target.nextStep,
      nextStepAt: target.nextStepAt
    }
  });
  revalidateOpportunityPaths(targetId);
}

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function revalidateOpportunityPaths(targetId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/pipeline");
  revalidatePath("/targets");
  revalidatePath(`/targets/${targetId}`);
  revalidatePath("/analytics");
}
