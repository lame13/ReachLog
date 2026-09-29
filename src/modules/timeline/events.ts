import { formatDateTime } from "@/modules/core/dates";
import { getSqlite } from "@/modules/core/db/client";

export type TimelineItem = {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  label: string;
  detail: string | null;
  createdAt: string;
  href: string | null;
};

export type TimelineScope = {
  targetIds?: string[];
  accountId?: string;
  contactId?: string;
  limit?: number;
};

const eventLabels: Record<string, string> = {
  target_created: "Target created",
  target_updated: "Target updated",
  target_update_blocked: "Target update blocked",
  outreach_logged: "Outreach logged",
  email_sent: "Email sent",
  email_received: "Email received",
  reply_received: "Reply received",
  email_bounced: "Email bounced",
  bounced: "Bounced",
  form_submitted: "Contact form submitted",
  followup_due: "Follow-up due",
  followup_sent: "Follow-up sent",
  followup_completed: "Follow-up completed",
  followup_snoozed: "Follow-up snoozed",
  followup_scheduled: "Follow-up scheduled",
  note_added: "Note added",
  stage_changed: "Stage changed",
  target_marked_dead: "Marked dead",
  do_not_resend_enabled: "Do not resend enabled",
  do_not_resend_disabled: "Do not resend disabled",
  send_queued: "Send queued",
  send_failed: "Send failed",
  send_blocked: "Send blocked",
  send_duplicate_blocked: "Duplicate send blocked",
  send_record_recovered: "Send record recovered",
  demo_email_simulated: "Email simulated (demo)",
  email_verified: "Email verified",
  email_verification_failed: "Email verification failed",
  account_created: "Account created",
  account_updated: "Account updated",
  account_note_added: "Note added",
  contact_created: "Contact created",
  contact_updated: "Contact updated",
  contact_note_added: "Note added"
};

export function eventLabel(eventType: string) {
  return (
    eventLabels[eventType] ??
    eventType.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase())
  );
}

/**
 * Pulls the activity for a target, an account (including every target under it)
 * or a contact from the events table. Events are already written by sending,
 * syncing, importing and the manual actions, so the timeline needs no new
 * bookkeeping of its own.
 */
export function getTimeline({
  targetIds = [],
  accountId,
  contactId,
  limit = 60
}: TimelineScope): TimelineItem[] {
  const clauses: string[] = [];
  const values: string[] = [];

  if (targetIds.length) {
    clauses.push(
      `(events.entity_type = 'target' AND events.entity_id IN (${targetIds
        .map(() => "?")
        .join(", ")}))`
    );
    values.push(...targetIds);
  }

  if (accountId) {
    clauses.push("(events.entity_type = 'account' AND events.entity_id = ?)");
    values.push(accountId);
  }

  if (contactId) {
    clauses.push("(events.entity_type = 'contact' AND events.entity_id = ?)");
    values.push(contactId);
  }

  if (!clauses.length) {
    return [];
  }

  const rows = getSqlite()
    .prepare(
      `
      SELECT
        events.id,
        events.entity_type as entityType,
        events.entity_id as entityId,
        events.event_type as eventType,
        events.payload_json as payloadJson,
        events.created_at as createdAt
      FROM events
      WHERE ${clauses.join(" OR ")}
      ORDER BY events.created_at DESC, events.rowid DESC
      LIMIT ?
    `
    )
    .all(...values, limit) as Array<{
    id: string;
    entityType: string;
    entityId: string;
    eventType: string;
    payloadJson: string | null;
    createdAt: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    eventType: row.eventType,
    label: eventLabel(row.eventType),
    detail: describeEventPayload(row.payloadJson),
    createdAt: row.createdAt,
    href: entityHref(row.entityType, row.entityId)
  }));
}

function entityHref(entityType: string, entityId: string) {
  if (entityType === "target") {
    return `/targets/${entityId}`;
  }

  if (entityType === "account") {
    return `/accounts/${entityId}`;
  }

  if (entityType === "contact") {
    return `/contacts/${entityId}`;
  }

  return null;
}

/**
 * Turns the stored event payload into the one or two lines a person needs to
 * read. Unknown keys are ignored so future events never break the timeline.
 */
export function describeEventPayload(payloadJson: string | null) {
  if (!payloadJson) {
    return null;
  }

  let payload: Record<string, unknown>;

  try {
    const parsed: unknown = JSON.parse(payloadJson);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const text = (key: string) =>
    typeof payload[key] === "string" && payload[key] ? (payload[key] as string) : null;
  const lines = [
    text("from") ? `from: ${text("from")}` : null,
    text("to") && !text("from") ? `to: ${text("to")}` : null,
    text("reason") ? `reason: ${text("reason")}` : null,
    text("status") ? `status: ${text("status")}` : null,
    text("stage") ? `stage: ${text("stage")}` : null,
    text("previousStage") ? `from stage: ${text("previousStage")}` : null,
    text("dedupeKey") ? `dedupe key: ${text("dedupeKey")}` : null,
    text("replyType") ? `reply type: ${text("replyType")}` : null,
    typeof payload.doNotResend === "boolean"
      ? `do not resend: ${payload.doNotResend ? "on" : "off"}`
      : null,
    text("messageId") ? `message: ${text("messageId")}` : null,
    text("dueAt") ? `follow-up due: ${formatDateTime(text("dueAt"))}` : null,
    text("nextFollowupAt")
      ? `next follow-up: ${formatDateTime(text("nextFollowupAt"))}`
      : null,
    text("note")
  ].filter((line): line is string => Boolean(line));

  return lines.length ? lines.join("\n") : null;
}
