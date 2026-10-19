import { getSqlite } from "@/modules/core/db/client";
import { aiReady } from "./client";
import { draftDueFollowups } from "./followup";
import { triageReplyMessage } from "./triage";
import { processUnlinkedMail } from "./unlinked";

export type AiWorkerSummary = {
  triaged: number;
  followupsDrafted: number;
  followupsSent: number;
  leadsCaptured: number;
  errors: string[];
};

export async function runAiAutomation(
  request: typeof fetch = fetch,
  limit = 10
): Promise<AiWorkerSummary> {
  const summary: AiWorkerSummary = {
    triaged: 0,
    followupsDrafted: 0,
    followupsSent: 0,
    leadsCaptured: 0,
    errors: []
  };

  if (!aiReady()) return summary;

  for (const messageId of replyTriageCandidates(limit)) {
    try {
      const result = await triageReplyMessage(messageId, request);
      if (result) summary.triaged += 1;
    } catch (error) {
      summary.errors.push(
        `reply triage ${messageId}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }

  try {
    const followups = await draftDueFollowups(request, limit);
    summary.followupsDrafted = followups.filter((result) => result.drafted).length;
    summary.followupsSent = followups.filter((result) => result.sent).length;
    for (const result of followups) {
      if (result.error) {
        summary.errors.push(`follow-up ${result.followupId}: ${result.error}`);
      }
    }
  } catch (error) {
    summary.errors.push(
      `follow-up drafting: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }

  try {
    const leads = await processUnlinkedMail(request, limit);
    summary.leadsCaptured = leads.filter((result) => result.captured).length;
    for (const result of leads) {
      if (result.kind === "error") {
        summary.errors.push(`unlinked lead ${result.eventId}: failed`);
      }
    }
  } catch (error) {
    summary.errors.push(
      `unlinked mail: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }

  return summary;
}

function replyTriageCandidates(limit: number) {
  return (
    getSqlite()
      .prepare(
        `
        SELECT messages.id
        FROM messages
        INNER JOIN threads ON threads.id = messages.thread_id
        INNER JOIN targets ON targets.id = threads.target_id
        WHERE messages.direction = 'inbound'
          AND NOT EXISTS (
            SELECT 1 FROM messages newer
            WHERE newer.thread_id = messages.thread_id
              AND COALESCE(newer.sent_at, newer.received_at, newer.created_at)
                > COALESCE(messages.sent_at, messages.received_at, messages.created_at)
          )
          AND NOT EXISTS (
            SELECT 1 FROM ai_runs
            WHERE ai_runs.kind = 'reply_triage'
              AND ai_runs.entity_id = messages.id
              AND ai_runs.status IN ('success', 'running')
          )
          AND NOT EXISTS (
            SELECT 1 FROM events
            WHERE events.event_type IN ('mail_notification_received', 'email_bounced')
              AND json_valid(events.payload_json)
              AND json_extract(events.payload_json, '$.messageId') = messages.message_id
          )
          AND targets.stage NOT IN ('won', 'lost')
        ORDER BY COALESCE(messages.received_at, messages.created_at) DESC
        LIMIT ?
      `
      )
      .all(limit) as Array<{ id: string }>
  ).map((row) => row.id);
}
