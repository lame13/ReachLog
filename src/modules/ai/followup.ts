import { env } from "@/modules/core/env";
import { getSqlite } from "@/modules/core/db/client";
import { isEmailVerificationBlocking } from "@/modules/emailVerification/service";
import { isTargetActionBlocked } from "@/modules/outreach/status";
import { getEmailDraft, saveEmailDraft } from "@/modules/smtp/drafts";
import { sendOutboundEmail } from "@/modules/smtp/send";
import { recordEvent } from "@/modules/timeline/record";
import { aiReady, runAiJson } from "./client";
import { AI_SYSTEM_PROMPT, followupDraftPrompt } from "./prompts";
import { followupDraftSchema } from "./schemas";
import { setReviewStatus } from "./triage";

const MAX_AI_FOLLOWUPS = 3;

export type FollowupAutomationResult = {
  followupId: string;
  drafted: boolean;
  sent: boolean;
  error?: string;
};

export async function draftDueFollowups(
  request: typeof fetch = fetch,
  limit = 10
): Promise<FollowupAutomationResult[]> {
  if (!aiReady()) return [];
  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const rows = sqlite
    .prepare(
      `
      SELECT
        followup_tasks.id,
        followup_tasks.thread_id as threadId,
        followup_tasks.target_id as targetId,
        followup_tasks.due_at as dueAt,
        targets.company_name as companyName,
        targets.stage,
        targets.status,
        targets.do_not_resend as doNotResend,
        targets.source_type as sourceType,
        targets.source_url as sourceUrl,
        targets.dedupe_key as dedupeKey,
        contacts.name as contactName,
        contacts.email as contactEmail,
        contacts.email_verification_status as emailVerificationStatus,
        threads.subject as threadSubject,
        threads.last_inbound_at as lastInboundAt,
        threads.last_outbound_at as lastOutboundAt
      FROM followup_tasks
      INNER JOIN targets ON targets.id = followup_tasks.target_id
      INNER JOIN threads ON threads.id = followup_tasks.thread_id
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      WHERE followup_tasks.status = 'open'
        AND followup_tasks.due_at <= ?
        AND targets.stage NOT IN ('won', 'lost')
        AND NOT EXISTS (
          SELECT 1 FROM ai_runs
          WHERE ai_runs.kind = 'followup_draft'
            AND ai_runs.entity_id = followup_tasks.id
            AND ai_runs.status = 'success'
        )
      ORDER BY followup_tasks.due_at ASC
      LIMIT ?
    `
    )
    .all(now, limit) as Array<{
    id: string;
    threadId: string;
    targetId: string;
    dueAt: string;
    companyName: string;
    stage: string;
    status: string;
    doNotResend: number;
    sourceType: string;
    sourceUrl: string | null;
    dedupeKey: string;
    contactName: string | null;
    contactEmail: string | null;
    emailVerificationStatus: string | null;
    threadSubject: string;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
  }>;

  const results: FollowupAutomationResult[] = [];

  for (const row of rows) {
    try {
      const result = await draftOneFollowup(row, request);
      results.push(result);
    } catch (error) {
      results.push({
        followupId: row.id,
        drafted: false,
        sent: false,
        error: error instanceof Error ? error.message : "Unknown AI error"
      });
    }
  }

  return results;
}

async function draftOneFollowup(
  row: {
    id: string;
    threadId: string;
    targetId: string;
    dueAt: string;
    companyName: string;
    stage: string;
    status: string;
    doNotResend: number;
    sourceType: string;
    sourceUrl: string | null;
    dedupeKey: string;
    contactName: string | null;
    contactEmail: string | null;
    emailVerificationStatus: string | null;
    threadSubject: string;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
  },
  request: typeof fetch
): Promise<FollowupAutomationResult> {
  const sqlite = getSqlite();
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
    .all(row.threadId) as Array<{
    direction: string;
    fromEmail: string;
    subject: string;
    bodyText: string | null;
    at: string | null;
  }>;
  const attempt = messages.filter((message) => message.direction === "outbound").length;
  const now = new Date().toISOString();
  const { run, output } = await runAiJson({
    kind: "followup_draft",
    entityType: "followup",
    entityId: row.id,
    targetId: row.targetId,
    input: {
      followupId: row.id,
      threadId: row.threadId,
      dueAt: row.dueAt,
      stage: row.stage,
      attempt,
      messages
    },
    schema: followupDraftSchema,
    system: AI_SYSTEM_PROMPT,
    user: followupDraftPrompt({
      now,
      company: row.companyName,
      contact: row.contactName,
      stage: row.stage,
      attempt,
      messages
    }),
    request
  });

  // The provider request yields to mailbox sync and operator actions. Discard
  // this suggestion if the task or conversation changed while it was running.
  const current = sqlite.prepare(`
    SELECT followup_tasks.status, followup_tasks.due_at AS dueAt,
      targets.stage, contacts.email AS contactEmail,
      threads.last_inbound_at AS lastInboundAt,
      threads.last_outbound_at AS lastOutboundAt
    FROM followup_tasks
    INNER JOIN targets ON targets.id = followup_tasks.target_id
    INNER JOIN threads ON threads.id = followup_tasks.thread_id
    LEFT JOIN contacts ON contacts.id = targets.contact_id
    WHERE followup_tasks.id = ?
  `).get(row.id) as {
    status: string;
    dueAt: string;
    stage: string;
    contactEmail: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
  } | undefined;
  if (!current || current.status !== "open" ||
    current.dueAt !== row.dueAt || current.stage !== row.stage ||
    current.contactEmail !== row.contactEmail ||
    current.lastInboundAt !== row.lastInboundAt ||
    current.lastOutboundAt !== row.lastOutboundAt) {
    // Leave it retryable so an open, rescheduled task can get a fresh draft.
    sqlite.prepare("UPDATE ai_runs SET status = 'failed', review_status = 'none', error = ? WHERE id = ?")
      .run("The task or conversation changed during drafting. Retry with current context.", run.id);
    return { followupId: row.id, drafted: false, sent: false };
  }

  sqlite
    .prepare(
      "UPDATE followup_tasks SET suggested_subject = ?, suggested_body = ? WHERE id = ?"
    )
    .run(output.subject, output.body, row.id);
  if (!getEmailDraft(row.targetId)) {
    saveEmailDraft(row.targetId, {
      subject: output.subject,
      body: output.body,
      fromEmail: ""
    });
  }

  const blocked = isTargetActionBlocked(row);
  const existingDraft = getEmailDraft(row.targetId);
  const draftInProgress = Boolean(existingDraft &&
    (existingDraft.subject !== output.subject || existingDraft.body !== output.body));
  const autoReplyRecent = recentAutoReply(row.targetId);
  const canAutoSend =
    env.AI_AUTO_SEND &&
    !blocked &&
    !draftInProgress &&
    !autoReplyRecent &&
    Boolean(row.contactEmail) &&
    !isEmailVerificationBlocking(row.emailVerificationStatus) &&
    !hasNewerInbound(row) &&
    attempt >= 1 &&
    attempt <= MAX_AI_FOLLOWUPS &&
    dailyAiSends() < env.AI_DAILY_SEND_LIMIT;

  if (!canAutoSend) {
    setReviewStatus(run.id, "pending");
    recordEvent({
      entityType: "target",
      entityId: row.targetId,
      eventType: "ai_followup_drafted",
      payload: {
        runId: run.id,
        followupId: row.id,
        reason: blocked
          ? "target_blocked"
          : draftInProgress
            ? "draft_in_progress"
            : autoReplyRecent
              ? "recent_auto_reply"
            : !env.AI_AUTO_SEND
              ? "auto_send_off"
              : "send_guard"
      }
    });
    return { followupId: row.id, drafted: true, sent: false };
  }

  const send = await sendOutboundEmail({
    targetId: row.targetId,
    threadId: row.threadId,
    subject: output.subject,
    body: output.body,
    sendKey: `ai-followup:${row.id}`,
    createFollowup: attempt < MAX_AI_FOLLOWUPS,
    followupDays: 5
  });

  if (!send.ok) {
    setReviewStatus(run.id, "pending");
    recordEvent({
      entityType: "target",
      entityId: row.targetId,
      eventType: "ai_followup_send_failed",
      payload: { runId: run.id, followupId: row.id, error: send.message }
    });
    return {
      followupId: row.id,
      drafted: true,
      sent: false,
      error: send.message
    };
  }

  setReviewStatus(run.id, "applied");
  recordEvent({
    entityType: "target",
    entityId: row.targetId,
    eventType: "ai_followup_sent",
    payload: {
      runId: run.id,
      followupId: row.id,
      outboundSendId: send.outboundSendId
    }
  });

  return { followupId: row.id, drafted: true, sent: true };
}

function hasNewerInbound(row: {
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
}) {
  return Boolean(
    row.lastInboundAt &&
      (!row.lastOutboundAt || row.lastInboundAt > row.lastOutboundAt)
  );
}

function dailyAiSends() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return (
    getSqlite()
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM outbound_sends
        WHERE send_key LIKE 'ai-followup:%'
          AND status IN ('sent', 'smtp_accepted_persist_failed')
          AND sent_at >= ?
      `
      )
      .get(start.toISOString()) as { count: number }
  ).count;
}

function recentAutoReply(targetId: string) {
  return Boolean(
    getSqlite()
      .prepare(
        `
        SELECT 1
        FROM events
        WHERE entity_type = 'target'
          AND entity_id = ?
          AND event_type = 'mail_notification_received'
          AND json_valid(payload_json)
          AND json_extract(payload_json, '$.reason') = 'auto_reply'
          AND created_at >= ?
        LIMIT 1
      `
      )
      .get(targetId, new Date(Date.now() - 14 * 86_400_000).toISOString())
  );
}
