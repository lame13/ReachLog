import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import {
  getPipelineStage,
  pipelineStageIndex,
  statusForStageMove
} from "@/modules/pipeline/stages";
import { recordEvent } from "@/modules/timeline/record";
import { getEmailDraft, saveEmailDraft } from "@/modules/smtp/drafts";
import { runAiJson, type AiRunRow } from "./client";
import { AI_SYSTEM_PROMPT, replyTriagePrompt } from "./prompts";
import {
  replyTriageSchema,
  type ReplyTriageOutput
} from "./schemas";

export type TriageResult = {
  run: AiRunRow;
  output: ReplyTriageOutput;
  stageApplied: boolean;
  followupCreated: boolean;
};

export async function triageReplyMessage(
  messageId: string,
  request: typeof fetch = fetch
): Promise<TriageResult | null> {
  const sqlite = getSqlite();
  const message = sqlite
    .prepare(
      `
      SELECT
        messages.id, messages.thread_id as threadId, messages.subject,
        messages.body_text as bodyText, messages.from_email as fromEmail,
        messages.direction, messages.received_at as receivedAt,
        threads.target_id as targetId
      FROM messages
      INNER JOIN threads ON threads.id = messages.thread_id
      WHERE messages.id = ?
    `
    )
    .get(messageId) as
    | {
        id: string;
        threadId: string;
        targetId: string;
        subject: string;
        bodyText: string | null;
        fromEmail: string;
        direction: string;
        receivedAt: string | null;
      }
    | undefined;

  if (!message || message.direction !== "inbound") return null;

  const target = sqlite
    .prepare(
      `
      SELECT
        targets.id, targets.company_name as companyName, targets.stage,
        targets.status, targets.do_not_resend as doNotResend,
        contacts.name as contactName, contacts.email as contactEmail
      FROM targets
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      WHERE targets.id = ?
    `
    )
    .get(message.targetId) as
    | {
        id: string;
        companyName: string;
        stage: string;
        status: string;
        doNotResend: number;
        contactName: string | null;
        contactEmail: string | null;
      }
    | undefined;

  if (!target) return null;

  const messages = sqlite
    .prepare(
      `
      SELECT
        direction, from_email as fromEmail, subject, body_text as bodyText,
        COALESCE(sent_at, received_at, created_at) as at
      FROM messages
      WHERE thread_id = ?
      ORDER BY COALESCE(sent_at, received_at, created_at) ASC
    `
    )
    .all(message.threadId) as Array<{
    direction: string;
    fromEmail: string;
    subject: string;
    bodyText: string | null;
    at: string | null;
  }>;

  const now = new Date().toISOString();
  const { run, output } = await runAiJson({
    kind: "reply_triage",
    entityType: "message",
    entityId: message.id,
    targetId: target.id,
    input: {
      messageId: message.id,
      targetId: target.id,
      stage: target.stage,
      status: target.status,
      messages
    },
    schema: replyTriageSchema,
    system: AI_SYSTEM_PROMPT,
    user: replyTriagePrompt({
      now,
      company: target.companyName,
      contact: target.contactName,
      stage: target.stage,
      status: target.status,
      messages
    }),
    request
  });

  const stageApplied = applyTriageStage({
    target,
    output,
    force: false
  });
  const followupCreated = createTriageFollowup({
    target,
    threadId: message.threadId,
    output,
    force: false
  });

  const optOutApplied = applyOptOut({
    target,
    output
  });

  sqlite
    .prepare(
      `
      UPDATE threads
      SET ai_intent = ?,
          ai_confidence = ?,
          ai_stage_suggestion = ?,
          ai_summary = ?,
          ai_assessed_at = ?,
          updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      output.intent,
      output.confidence,
      output.suggestedStage,
      output.summary,
      now,
      now,
      message.threadId
    );

  const needsReview =
    !stageApplied &&
    !followupCreated &&
    !optOutApplied &&
    ["interested", "question", "needs_information", "not_now", "not_interested", "wrong_person", "referral", "unclear"].includes(
      output.intent
    );
  const reviewStatus = stageApplied || followupCreated || optOutApplied
    ? "applied"
    : needsReview
      ? "pending"
      : "none";

  setReviewStatus(run.id, reviewStatus);

  recordEvent({
    entityType: "target",
    entityId: target.id,
    eventType: "ai_reply_triaged",
    payload: {
      runId: run.id,
      messageId: message.id,
      intent: output.intent,
      confidence: output.confidence,
      stageApplied,
      followupCreated,
      reviewStatus
    }
  });

  return {
    run: { ...run, reviewStatus },
    output,
    stageApplied,
    followupCreated
  };
}

export function applyTriageStage({
  target,
  output,
  force
}: {
  target: {
    id: string;
    stage: string;
    status: string;
    doNotResend: number;
  };
  output: ReplyTriageOutput;
  force: boolean;
}) {
  const suggested = output.suggestedStage;
  if (!suggested) return false;

  const current = getPipelineStage(target.stage);
  const suggestedStage = getPipelineStage(suggested);

  if (current.kind !== "open") return false;
  if (!force && suggestedStage.kind !== "open") return false;
  if (!force && pipelineStageIndex(suggested) <= pipelineStageIndex(current.key)) return false;
  if (!force && (output.stageConfidence < 0.85 || output.confidence < 0.75)) return false;
  if (!force && manuallyMovedRecently(target.id)) return false;

  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const status = statusForStageMove(target.status, suggested, target.doNotResend);

  sqlite.transaction(() => {
    sqlite
      .prepare("UPDATE targets SET stage = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(suggested, status, now, target.id);

    if (suggested === "lost") {
      sqlite
        .prepare(
          "UPDATE followup_tasks SET status = 'cancelled', completed_at = ? WHERE target_id = ? AND status = 'open'"
        )
        .run(now, target.id);
    }
  })();

  recordEvent({
    entityType: "target",
    entityId: target.id,
    eventType: "stage_changed",
    payload: {
      source: "ai",
      stage: suggested,
      previousStage: current.key,
      previousStatus: target.status,
      status
    }
  });

  return true;
}

export function createTriageFollowup({
  target,
  threadId,
  output,
  force
}: {
  target: { id: string };
  threadId: string;
  output: ReplyTriageOutput;
  force: boolean;
}) {
  if (!output.draft) return false;
  if (output.nextAction.type === "none" && !force) return false;

  // A reply is work for the operator, not a follow-up. Save it as the current
  // draft so the composer opens with it, but never queue it as an automated
  // follow-up that could be sent by the cadence worker.
  if (output.nextAction.type === "reply") {
    saveDraftIfEmpty(target.id, output.draft.subject, output.draft.body);
    return false;
  }

  if (output.nextAction.type === "wait" && output.nextAction.dueInDays === null && !force) {
    return false;
  }

  const dueInDays = output.nextAction.dueInDays;
  if (dueInDays === null && !force) return false;
  const days = Math.max(
    output.nextAction.type === "follow_up" ? 1 : 0,
    Math.min(365, dueInDays ?? 2)
  );
  const dueAt = new Date(Date.now() + days * 86_400_000);
  dueAt.setUTCHours(9, 0, 0, 0);
  const dueAtIso = dueAt.toISOString();
  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const existing = sqlite
    .prepare(
      "SELECT id, due_at as dueAt FROM followup_tasks WHERE target_id = ? AND status = 'open' ORDER BY due_at ASC LIMIT 1"
    )
    .get(target.id) as { id: string; dueAt: string } | undefined;

  if (existing) {
    sqlite
      .prepare(
        "UPDATE followup_tasks SET suggested_subject = ?, suggested_body = ? WHERE id = ?"
      )
      .run(output.draft.subject, output.draft.body, existing.id);
  } else {
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
        dueAtIso,
        output.draft.subject,
        output.draft.body,
        now
      );
  }

  sqlite
    .prepare("UPDATE threads SET next_followup_at = ?, updated_at = ? WHERE id = ?")
    .run(existing?.dueAt ?? dueAtIso, now, threadId);
  saveDraftIfEmpty(target.id, output.draft.subject, output.draft.body);
  recordEvent({
    entityType: "target",
    entityId: target.id,
    eventType: "ai_followup_drafted",
    payload: { threadId, dueAt: dueAtIso, source: "reply_triage" }
  });

  return true;
}

function applyOptOut({
  target,
  output
}: {
  target: { id: string; status: string; doNotResend: number };
  output: ReplyTriageOutput;
}) {
  if (!output.isOptOut || output.confidence < 0.9) return false;
  const sqlite = getSqlite();
  const now = new Date().toISOString();

  sqlite
    .prepare(
      "UPDATE targets SET do_not_resend = 1, status = 'do not send', updated_at = ? WHERE id = ?"
    )
    .run(now, target.id);
  sqlite
    .prepare(
      "UPDATE followup_tasks SET status = 'cancelled', completed_at = ? WHERE target_id = ? AND status = 'open'"
    )
    .run(now, target.id);
  recordEvent({
    entityType: "target",
    entityId: target.id,
    eventType: "ai_opt_out",
    payload: { previousStatus: target.status, evidence: output.evidence }
  });

  return true;
}

function saveDraftIfEmpty(targetId: string, subject: string, body: string) {
  if (getEmailDraft(targetId)) return;
  const fromEmail = getSqlite()
    .prepare(
      `
      SELECT messages.from_email as fromEmail
      FROM messages
      INNER JOIN threads ON threads.id = messages.thread_id
      WHERE threads.target_id = ?
        AND messages.direction = 'outbound'
        AND messages.from_email IS NOT NULL
        AND trim(messages.from_email) != ''
      ORDER BY COALESCE(messages.sent_at, messages.created_at) DESC
      LIMIT 1
    `
    )
    .get(targetId) as { fromEmail: string } | undefined;
  saveEmailDraft(targetId, {
    subject,
    body,
    fromEmail: fromEmail?.fromEmail ?? ""
  });
}

function manuallyMovedRecently(targetId: string) {
  return Boolean(
    getSqlite()
      .prepare(
        `
        SELECT 1
        FROM events
        WHERE entity_type = 'target'
          AND entity_id = ?
          AND event_type = 'stage_changed'
          AND created_at >= ?
          AND COALESCE(json_extract(payload_json, '$.source'), '') <> 'ai'
        LIMIT 1
      `
      )
      .get(targetId, new Date(Date.now() - 7 * 86_400_000).toISOString())
  );
}

export function setReviewStatus(runId: string, reviewStatus: string) {
  getSqlite()
    .prepare(
      "UPDATE ai_runs SET review_status = ?, reviewed_at = CASE WHEN ? IN ('applied','rejected') THEN ? ELSE reviewed_at END, updated_at = ? WHERE id = ?"
    )
    .run(reviewStatus, reviewStatus, new Date().toISOString(), new Date().toISOString(), runId);
}
