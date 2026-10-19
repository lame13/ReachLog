"use server";

import { revalidatePath } from "next/cache";
import { getSqlite } from "@/modules/core/db/client";
import { getAiRun } from "./client";
import { replyTriageSchema, unlinkedLeadSchema } from "./schemas";
import {
  applyTriageStage,
  createTriageFollowup,
  setReviewStatus
} from "./triage";
import { captureUnlinkedRun } from "./unlinked";

export async function acceptAiSuggestionAction(formData: FormData) {
  const runId = String(formData.get("runId") ?? "");
  const run = runId ? getAiRun(runId) : undefined;
  if (!run || run.status !== "success" || !run.outputJson) return;

  if (run.kind === "reply_triage") {
    const parsed = replyTriageSchema.safeParse(JSON.parse(run.outputJson));
    if (!parsed.success) return;
    const target = getSqlite()
      .prepare(
        "SELECT id, stage, status, do_not_resend as doNotResend FROM targets WHERE id = ?"
      )
      .get(run.targetId) as
      | { id: string; stage: string; status: string; doNotResend: number }
      | undefined;
    if (!target) return;
    const thread = getSqlite()
      .prepare(
        "SELECT thread_id as threadId FROM messages WHERE id = ?"
      )
      .get(run.entityId) as { threadId: string } | undefined;

    applyTriageStage({ target, output: parsed.data, force: true });
    if (thread) {
      createTriageFollowup({
        target,
        threadId: thread.threadId,
        output: parsed.data,
        force: true
      });
    }
  } else if (run.kind === "unlinked_lead") {
    const parsed = unlinkedLeadSchema.safeParse(JSON.parse(run.outputJson));
    if (!parsed.success) return;
    if (!captureUnlinkedRun(run.id)) return;
  }

  setReviewStatus(run.id, "applied");
  revalidateReviewPaths(run.targetId);
}

export async function rejectAiSuggestionAction(formData: FormData) {
  const runId = String(formData.get("runId") ?? "");
  const run = runId ? getAiRun(runId) : undefined;
  if (!run) return;
  setReviewStatus(run.id, "rejected");
  revalidateReviewPaths(run.targetId);
}

function revalidateReviewPaths(targetId: string | null) {
  revalidatePath("/review");
  revalidatePath("/dashboard");
  revalidatePath("/targets");
  revalidatePath("/followups");
  if (targetId) revalidatePath(`/targets/${targetId}`);
}
