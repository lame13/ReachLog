import { getSqlite } from "@/modules/core/db/client";
import { AI_RUN_COLUMNS, type AiRunRow } from "./client";
import {
  followupDraftSchema,
  replyTriageSchema,
  unlinkedLeadSchema,
  type FollowupDraftOutput,
  type ReplyTriageOutput,
  type UnlinkedLeadOutput
} from "./schemas";

export type AiReviewItem =
  | {
      kind: "reply_triage";
      run: AiRunRow;
      output: ReplyTriageOutput;
      targetId: string | null;
      companyName: string | null;
      contactEmail: string | null;
      messageSubject: string | null;
    }
  | {
      kind: "followup_draft";
      run: AiRunRow;
      output: FollowupDraftOutput;
      targetId: string | null;
      companyName: string | null;
      contactEmail: string | null;
      dueAt: string | null;
    }
  | {
      kind: "unlinked_lead";
      run: AiRunRow;
      output: UnlinkedLeadOutput;
      from: string | null;
      subject: string | null;
    };

export function getPendingAiReviews(limit = 50): AiReviewItem[] {
  const rows = getSqlite()
    .prepare(
      `
      SELECT ${AI_RUN_COLUMNS} FROM ai_runs
      WHERE review_status = 'pending'
        AND status = 'success'
      ORDER BY created_at DESC
      LIMIT ?
    `
    )
    .all(limit) as AiRunRow[];
  const items: AiReviewItem[] = [];

  for (const run of rows) {
    const parsed = parseOutput(run);
    if (!parsed) continue;

    if (run.kind === "reply_triage") {
      const output = replyTriageSchema.safeParse(parsed);
      if (!output.success) continue;
      const context = getReplyContext(run.entityId);
      items.push({
        kind: "reply_triage",
        run,
        output: output.data,
        targetId: run.targetId ?? context?.targetId ?? null,
        companyName: context?.companyName ?? null,
        contactEmail: context?.contactEmail ?? null,
        messageSubject: context?.subject ?? null
      });
    } else if (run.kind === "followup_draft") {
      const output = followupDraftSchema.safeParse(parsed);
      if (!output.success) continue;
      const context = getFollowupContext(run.entityId);
      items.push({
        kind: "followup_draft",
        run,
        output: output.data,
        targetId: context?.targetId ?? null,
        companyName: context?.companyName ?? null,
        contactEmail: context?.contactEmail ?? null,
        dueAt: context?.dueAt ?? null
      });
    } else if (run.kind === "unlinked_lead") {
      const output = unlinkedLeadSchema.safeParse(parsed);
      if (!output.success) continue;
      const context = getUnlinkedContext(run.entityId);
      items.push({
        kind: "unlinked_lead",
        run,
        output: output.data,
        from: context?.from ?? null,
        subject: context?.subject ?? null
      });
    }
  }

  return items;
}

export function getPendingAiReviewCount() {
  return (
    getSqlite()
      .prepare(
        "SELECT COUNT(*) as count FROM ai_runs WHERE review_status = 'pending' AND status = 'success'"
      )
      .get() as { count: number }
  ).count;
}

export function getLatestTargetAiReview(targetId: string) {
  const run = getSqlite()
    .prepare(
      `SELECT ${AI_RUN_COLUMNS} FROM ai_runs WHERE target_id = ? AND kind = 'reply_triage' AND status = 'success' ORDER BY created_at DESC LIMIT 1`
    )
    .get(targetId) as AiRunRow | undefined;
  if (!run) return null;
  const parsed = parseOutput(run);
  if (!parsed) return null;
  const output = replyTriageSchema.safeParse(parsed);
  return output.success ? { run, output: output.data } : null;
}

function parseOutput(run: AiRunRow): unknown {
  if (!run.outputJson) return null;
  try {
    return JSON.parse(run.outputJson);
  } catch {
    return null;
  }
}

function getReplyContext(messageId: string) {
  return getSqlite()
    .prepare(
      `
      SELECT
        threads.target_id as targetId,
        targets.company_name as companyName,
        contacts.email as contactEmail,
        messages.subject
      FROM messages
      INNER JOIN threads ON threads.id = messages.thread_id
      INNER JOIN targets ON targets.id = threads.target_id
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      WHERE messages.id = ?
    `
    )
    .get(messageId) as
    | {
        targetId: string;
        companyName: string;
        contactEmail: string | null;
        subject: string;
      }
    | undefined;
}

function getFollowupContext(followupId: string) {
  return getSqlite()
    .prepare(
      `
      SELECT
        followup_tasks.target_id as targetId,
        followup_tasks.due_at as dueAt,
        targets.company_name as companyName,
        contacts.email as contactEmail
      FROM followup_tasks
      INNER JOIN targets ON targets.id = followup_tasks.target_id
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      WHERE followup_tasks.id = ?
    `
    )
    .get(followupId) as
    | {
        targetId: string;
        dueAt: string;
        companyName: string;
        contactEmail: string | null;
      }
    | undefined;
}

function getUnlinkedContext(eventId: string) {
  const row = getSqlite()
    .prepare("SELECT payload_json as payloadJson FROM events WHERE id = ?")
    .get(eventId) as { payloadJson: string | null } | undefined;
  if (!row?.payloadJson) return null;
  try {
    const payload: unknown = JSON.parse(row.payloadJson);
    if (!payload || typeof payload !== "object") return null;
    return {
      from: typeof Reflect.get(payload, "from") === "string" ? (Reflect.get(payload, "from") as string) : null,
      subject: typeof Reflect.get(payload, "subject") === "string" ? (Reflect.get(payload, "subject") as string) : null
    };
  } catch {
    return null;
  }
}
