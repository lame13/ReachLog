import { getSqlite } from "@/modules/core/db/client";
import { endOfTodayIso, startOfTodayIso } from "@/modules/core/dates";
import { getAccounts } from "@/modules/accounts/queries";
import { getContacts } from "@/modules/contacts/queries";
import {
  getTargets,
  type TargetFilters
} from "@/modules/outreach/queries";

export const exportEntities = [
  "accounts",
  "targets",
  "contacts",
  "messages",
  "followups",
  "events",
  "contact-forms",
  "outbound-sends"
] as const;

export type ExportEntity = (typeof exportEntities)[number];

export function isExportEntity(value: string): value is ExportEntity {
  return exportEntities.includes(value as ExportEntity);
}

export function getExportRows(entity: ExportEntity, params: URLSearchParams) {
  if (entity === "targets") {
    return getTargetsExport(params);
  }

  if (entity === "accounts") {
    return getAccountsExport(params);
  }

  if (entity === "contacts") {
    return getContactsExport(params);
  }

  if (entity === "messages") {
    return getMessagesExport(params);
  }

  if (entity === "followups") {
    return getFollowupsExport(params);
  }

  if (entity === "events") {
    return getEventsExport(params);
  }

  if (entity === "contact-forms") {
    return getContactFormsExport(params);
  }

  return getOutboundSendsExport(params);
}

function getAccountsExport(params: URLSearchParams) {
  const q = params.get("q");
  const stage = params.get("stage");
  const accountId = params.get("accountId");

  return getAccounts({
    q: q ?? undefined,
    stage: stage ?? undefined
  }).filter((account) => !accountId || account.id === accountId).map((account) => ({
    id: account.id,
    name: account.name,
    domain: account.domain,
    websiteUrl: account.websiteUrl,
    notes: account.notes,
    contactCount: account.contactCount,
    targetCount: account.targetCount,
    openTargetCount: account.openTargetCount,
    wonTargetCount: account.wonTargetCount,
    lastActivityAt: account.lastActivityAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  }));
}

function getTargetsExport(params: URLSearchParams) {
  const filters: TargetFilters = {
    accountId: params.get("accountId") ?? undefined,
    q: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
    stage: params.get("stage") ?? undefined,
    source: params.get("source") ?? undefined,
    domain: params.get("domain") ?? undefined,
    flag: params.get("flag") ?? undefined
  };

  return getTargets(filters).map((target) => ({
    id: target.id,
    companyName: target.companyName,
    accountId: target.accountId,
    accountName: target.accountName,
    contactName: target.contactName,
    contactEmail: target.contactEmail,
    domain: target.domain,
    websiteUrl: target.websiteUrl,
    sourceType: target.sourceType,
    sourceUrl: target.sourceUrl,
    dedupeKey: target.dedupeKey,
    status: target.status,
    stage: target.stage,
    doNotResend: target.doNotResend ? 1 : 0,
    activityAt: target.activityAt,
    updatedAt: target.updatedAt
  }));
}

function getMessagesExport(params: URLSearchParams) {
  const targetId = params.get("targetId");
  const contactId = params.get("contactId");
  const direction = params.get("direction");
  const clauses = [];
  const values: string[] = [];

  if (targetId) {
    clauses.push("targets.id = ?");
    values.push(targetId);
  }

  if (direction) {
    clauses.push("messages.direction = ?");
    values.push(direction);
  }

  if (contactId) {
    clauses.push("targets.contact_id = ?");
    values.push(contactId);
  }

  return getSqlite()
    .prepare(
      `
      SELECT
        messages.id,
        targets.id as targetId,
        targets.company_name as companyName,
        threads.id as threadId,
        messages.direction,
        messages.from_email as fromEmail,
        messages.to_email as toEmail,
        messages.cc,
        messages.bcc,
        messages.subject,
        messages.body_text as bodyText,
        messages.message_id as messageId,
        messages.in_reply_to as inReplyTo,
        messages.references_header as referencesHeader,
        messages.sent_at as sentAt,
        messages.received_at as receivedAt,
        messages.created_at as createdAt
      FROM messages
      INNER JOIN threads ON threads.id = messages.thread_id
      INNER JOIN targets ON targets.id = threads.target_id
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY messages.created_at DESC
    `
    )
    .all(...values) as Record<string, unknown>[];
}

function getContactsExport(params: URLSearchParams) {
  return getContacts({
    q: params.get("q") ?? undefined,
    domain: params.get("domain") ?? undefined,
    accountId: params.get("accountId") ?? undefined,
    contactId: params.get("contactId") ?? undefined,
    tag: params.get("tag") ?? undefined
  }).map((contact) => ({
    id: contact.id,
    accountId: contact.accountId,
    accountName: contact.accountName,
    name: contact.name,
    email: contact.email,
    domain: contact.domain,
    title: contact.title,
    phone: contact.phone,
    links: contact.linksJson,
    tags: contact.tags,
    notes: contact.notes,
    emailVerificationProvider: contact.emailVerificationProvider,
    emailVerificationStatus: contact.emailVerificationStatus,
    emailVerificationCheckedAt: contact.emailVerificationCheckedAt,
    emailVerificationError: contact.emailVerificationError,
    targetCount: contact.targetCount,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt
  }));
}

function getFollowupsExport(params: URLSearchParams) {
  const filter = params.get("filter") ?? "all";
  const clauses: string[] = [];
  const values: string[] = [];

  if (filter !== "all") {
    clauses.push("followup_tasks.status = 'open'");
  }

  if (filter === "due") {
    clauses.push("followup_tasks.due_at <= ?");
    values.push(endOfTodayIso());
  }

  if (filter === "overdue") {
    clauses.push("followup_tasks.due_at < ?");
    values.push(startOfTodayIso());
  }

  if (filter === "upcoming") {
    clauses.push("followup_tasks.due_at > ?");
    values.push(new Date().toISOString());
  }

  return getSqlite()
    .prepare(
      `
      SELECT
        followup_tasks.id,
        targets.id as targetId,
        targets.company_name as companyName,
        contacts.email as contactEmail,
        followup_tasks.thread_id as threadId,
        followup_tasks.due_at as dueAt,
        followup_tasks.status,
        followup_tasks.suggested_subject as suggestedSubject,
        followup_tasks.suggested_body as suggestedBody,
        followup_tasks.notification_sent_at as notificationSentAt,
        followup_tasks.notification_channel as notificationChannel,
        followup_tasks.notification_status as notificationStatus,
        followup_tasks.completed_at as completedAt,
        followup_tasks.created_at as createdAt
      FROM followup_tasks
      INNER JOIN targets ON targets.id = followup_tasks.target_id
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY followup_tasks.due_at DESC
    `
    )
    .all(...values) as Record<string, unknown>[];
}

function getEventsExport(params: URLSearchParams) {
  const targetId = params.get("targetId");
  const eventType = params.get("eventType");
  const clauses = [];
  const values: string[] = [];

  if (targetId) {
    clauses.push("events.entity_type = 'target' AND events.entity_id = ?");
    values.push(targetId);
  }

  if (eventType) {
    clauses.push("events.event_type = ?");
    values.push(eventType);
  }

  return getSqlite()
    .prepare(
      `
      SELECT
        events.id,
        events.entity_type as entityType,
        events.entity_id as entityId,
        targets.company_name as companyName,
        events.event_type as eventType,
        events.payload_json as payloadJson,
        events.created_at as createdAt
      FROM events
      LEFT JOIN targets ON targets.id = events.entity_id
        AND events.entity_type = 'target'
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY events.created_at DESC
    `
    )
    .all(...values) as Record<string, unknown>[];
}

function getContactFormsExport(params: URLSearchParams) {
  const targetId = params.get("targetId");

  return getSqlite()
    .prepare(
      `
      SELECT
        contact_form_submissions.id,
        targets.id as targetId,
        targets.company_name as companyName,
        contact_form_submissions.website_url as websiteUrl,
        contact_form_submissions.form_url as formUrl,
        contact_form_submissions.subject,
        contact_form_submissions.message_text as messageText,
        contact_form_submissions.submitted_at as submittedAt,
        contact_form_submissions.dedupe_key as dedupeKey,
        contact_form_submissions.notes,
        contact_form_submissions.created_at as createdAt
      FROM contact_form_submissions
      INNER JOIN targets ON targets.id = contact_form_submissions.target_id
      ${targetId ? "WHERE targets.id = ?" : ""}
      ORDER BY contact_form_submissions.submitted_at DESC
    `
    )
    .all(...(targetId ? [targetId] : [])) as Record<string, unknown>[];
}

function getOutboundSendsExport(params: URLSearchParams) {
  const status = params.get("status");

  return getSqlite()
    .prepare(
      `
      SELECT
        outbound_sends.id,
        targets.id as targetId,
        targets.company_name as companyName,
        outbound_sends.thread_id as threadId,
        outbound_sends.to_email as toEmail,
        outbound_sends.subject,
        outbound_sends.body_text as bodyText,
        outbound_sends.message_id as messageId,
        outbound_sends.send_key as sendKey,
        outbound_sends.status,
        outbound_sends.attempts,
        outbound_sends.last_error as lastError,
        outbound_sends.sent_at as sentAt,
        outbound_sends.created_at as createdAt,
        outbound_sends.updated_at as updatedAt
      FROM outbound_sends
      INNER JOIN targets ON targets.id = outbound_sends.target_id
      ${status ? "WHERE outbound_sends.status = ?" : ""}
      ORDER BY outbound_sends.updated_at DESC
    `
    )
    .all(...(status ? [status] : [])) as Record<string, unknown>[];
}
