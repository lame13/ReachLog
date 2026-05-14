import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, getSqlite } from "@/modules/core/db/client";
import {
  contactFormSubmissions,
  contacts,
  events,
  followupTasks,
  messages,
  moduleSettings,
  targets,
  threads
} from "@/modules/core/db/schema";
import { endOfTodayIso, startOfTodayIso } from "@/modules/core/dates";
import { isTargetActionBlocked } from "@/modules/outreach/status";

export type TargetListItem = Awaited<ReturnType<typeof getTargets>>[number];
export type FollowupListItem = Awaited<ReturnType<typeof getFollowups>>[number];
export type TargetFilters = {
  q?: string;
  status?: string;
  source?: string;
  domain?: string;
  flag?: string;
};

export const analyticsRangeOptions = [
  { key: "7d", label: "7 days" },
  { key: "14d", label: "2 weeks" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "30d", label: "Last 30 days" }
] as const;

export type AnalyticsRangeKey = (typeof analyticsRangeOptions)[number]["key"];

export type TargetListRow = {
  id: string;
  companyName: string;
  websiteUrl: string | null;
  sourceType: string;
  sourceUrl: string | null;
  dedupeKey: string;
  status: string;
  doNotResend: number;
  updatedAt: string;
  activityAt: string;
  contactName: string | null;
  contactEmail: string | null;
  emailVerificationStatus: string | null;
  domain: string | null;
};

export function getDashboardData() {
  const db = getDb();
  const sqlite = getSqlite();
  const dueFollowups = getFollowups("due");
  const overdueFollowups = getFollowups("overdue");

  const replyCount = sqlite
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM threads
      INNER JOIN targets ON targets.id = threads.target_id
      WHERE threads.status = 'replied'
        AND ${actionableTargetSql("targets")}
        AND NOT (${latestNonActionableMessageSql("threads.id")})
    `
    )
    .get() as { count: number };

  const sentNoReplyCount = sqlite
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM threads
      INNER JOIN targets ON targets.id = threads.target_id
      WHERE threads.status = 'waiting'
        AND ${actionableTargetSql("targets")}
    `
    )
    .get() as { count: number };

  const replies = sqlite
    .prepare(
      `
      SELECT
        threads.id as threadId,
        targets.id as targetId,
        targets.company_name as companyName,
        contacts.name as contactName,
        contacts.email as contactEmail,
        threads.last_inbound_at as lastInboundAt,
        threads.status
      FROM threads
      INNER JOIN targets ON targets.id = threads.target_id
      LEFT JOIN contacts ON contacts.id = threads.contact_id
      WHERE threads.status = 'replied'
        AND ${actionableTargetSql("targets")}
        AND NOT (${latestNonActionableMessageSql("threads.id")})
      ORDER BY threads.last_inbound_at DESC
      LIMIT 5
    `
    )
    .all() as Array<{
    threadId: string;
    targetId: string;
    companyName: string;
    contactName: string | null;
    contactEmail: string | null;
    lastInboundAt: string | null;
    status: string;
  }>;

  const followups = dueFollowups.slice(0, 5);

  const recentMessages = db
    .select({
      id: messages.id,
      targetId: targets.id,
      direction: messages.direction,
      fromEmail: messages.fromEmail,
      toEmail: messages.toEmail,
      subject: messages.subject,
      sentAt: messages.sentAt,
      receivedAt: messages.receivedAt,
      companyName: targets.companyName
    })
    .from(messages)
    .innerJoin(threads, eq(messages.threadId, threads.id))
    .innerJoin(targets, eq(threads.targetId, targets.id))
    .orderBy(sql`COALESCE(${messages.sentAt}, ${messages.receivedAt}, ${messages.createdAt}) DESC`)
    .limit(6)
    .all();

  const [failedSendCount] = sqlite
    .prepare(
      "SELECT COUNT(*) as count FROM outbound_sends WHERE status IN ('failed', 'smtp_accepted_persist_failed')"
    )
    .all() as Array<{ count: number }>;

  const failedSends = sqlite
    .prepare(
      `
      SELECT
        outbound_sends.id,
        outbound_sends.target_id as targetId,
        outbound_sends.to_email as toEmail,
        outbound_sends.subject,
        outbound_sends.status,
        outbound_sends.last_error as lastError,
        outbound_sends.updated_at as updatedAt,
        targets.company_name as companyName
      FROM outbound_sends
      INNER JOIN targets ON targets.id = outbound_sends.target_id
      WHERE outbound_sends.status IN ('failed', 'smtp_accepted_persist_failed')
      ORDER BY outbound_sends.updated_at DESC
      LIMIT 5
    `
    )
    .all() as Array<{
    id: string;
    targetId: string;
    toEmail: string;
    subject: string;
    status: string;
    lastError: string | null;
    updatedAt: string;
    companyName: string;
  }>;

  return {
    stats: {
      repliesNeedingAction: replyCount.count,
      followupsDue: dueFollowups.length,
      overdueFollowups: overdueFollowups.length,
      sentNoReply: sentNoReplyCount?.count ?? 0,
      failedSends: failedSendCount?.count ?? 0
    },
    replies,
    followups,
    recentMessages,
    failedSends
  };
}

export function getTargets(filters: TargetFilters = {}) {
  const rows = getSqlite()
    .prepare(
      `
      SELECT
        targets.id,
        targets.company_name as companyName,
        targets.website_url as websiteUrl,
        targets.source_type as sourceType,
        targets.source_url as sourceUrl,
        targets.dedupe_key as dedupeKey,
        targets.status,
        targets.do_not_resend as doNotResend,
        targets.updated_at as updatedAt,
        MAX(
          targets.updated_at,
          COALESCE((
            SELECT MAX(COALESCE(messages.sent_at, messages.received_at, messages.created_at))
            FROM messages
            INNER JOIN threads ON threads.id = messages.thread_id
            WHERE threads.target_id = targets.id
          ), ''),
          COALESCE((
            SELECT MAX(threads.updated_at)
            FROM threads
            WHERE threads.target_id = targets.id
          ), '')
        ) as activityAt,
        contacts.name as contactName,
        contacts.email as contactEmail,
        contacts.email_verification_status as emailVerificationStatus,
        contacts.domain
      FROM targets
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      ORDER BY activityAt DESC, targets.updated_at DESC, targets.company_name ASC
    `
    )
    .all() as TargetListRow[];

  return rows.filter((target) => {
    const q = filters.q?.trim().toLowerCase();
    const status = filters.status?.trim();
    const source = filters.source?.trim();
    const domain = filters.domain?.trim().toLowerCase();
    const flag = filters.flag?.trim();

    if (q) {
      const haystack = [
        target.companyName,
        target.contactName,
        target.contactEmail,
        target.domain,
        target.websiteUrl,
        target.sourceUrl,
        target.dedupeKey,
        target.status
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(q)) {
        return false;
      }
    }

    if (status && target.status !== status) {
      return false;
    }

    if (source && target.sourceType !== source) {
      return false;
    }

    if (domain && target.domain?.toLowerCase() !== domain) {
      return false;
    }

    if (flag === "do_not_resend" && !target.doNotResend) {
      return false;
    }

    if (flag === "contact_form" && target.sourceType !== "contact_form") {
      return false;
    }

    return true;
  });
}

export function getTargetFilterOptions() {
  const targets = getTargets();
  const unique = (values: Array<string | null>) =>
    Array.from(new Set(values.filter(Boolean) as string[])).sort();

  return {
    statuses: unique(targets.map((target) => target.status)),
    sources: unique(targets.map((target) => target.sourceType)),
    domains: unique(targets.map((target) => target.domain))
  };
}

export function getTargetDetail(id: string) {
  const db = getDb();

  const target = db
    .select({
      id: targets.id,
      contactId: targets.contactId,
      companyName: targets.companyName,
      websiteUrl: targets.websiteUrl,
      sourceType: targets.sourceType,
      sourceUrl: targets.sourceUrl,
      dedupeKey: targets.dedupeKey,
      status: targets.status,
      doNotResend: targets.doNotResend,
      createdAt: targets.createdAt,
      updatedAt: targets.updatedAt,
      contactName: contacts.name,
      contactEmail: contacts.email,
      emailVerificationProvider: contacts.emailVerificationProvider,
      emailVerificationStatus: contacts.emailVerificationStatus,
      emailVerificationCheckedAt: contacts.emailVerificationCheckedAt,
      emailVerificationError: contacts.emailVerificationError,
      domain: contacts.domain
    })
    .from(targets)
    .leftJoin(contacts, eq(targets.contactId, contacts.id))
    .where(eq(targets.id, id))
    .get();

  if (!target) {
    return null;
  }

  const threadRows = db
    .select()
    .from(threads)
    .where(eq(threads.targetId, id))
    .orderBy(desc(threads.updatedAt))
    .all();

  const threadIds = threadRows.map((thread) => thread.id);
  const messageRows = threadIds.length
      ? db
        .select()
        .from(messages)
        .where(inArray(messages.threadId, threadIds))
        .orderBy(sql`COALESCE(${messages.sentAt}, ${messages.receivedAt}, ${messages.createdAt}) DESC`)
        .all()
    : [];

  if (threadIds.length) {
    markInboundMessagesRead(threadIds);
  }

  const followups = db
    .select()
    .from(followupTasks)
    .where(eq(followupTasks.targetId, id))
    .orderBy(desc(followupTasks.dueAt))
    .all();

  const forms = db
    .select()
    .from(contactFormSubmissions)
    .where(eq(contactFormSubmissions.targetId, id))
    .orderBy(desc(contactFormSubmissions.submittedAt))
    .all();

  const timeline = db
    .select()
    .from(events)
    .where(and(eq(events.entityType, "target"), eq(events.entityId, id)))
    .orderBy(desc(events.createdAt))
    .all();

  return {
    target,
    threads: threadRows,
    messages: messageRows,
    followups,
    forms,
    timeline
  };
}

function markInboundMessagesRead(threadIds: string[]) {
  const placeholders = threadIds.map(() => "?").join(", ");

  getSqlite()
    .prepare(
      `
      UPDATE messages
      SET read_at = ?
      WHERE read_at IS NULL
        AND direction = 'inbound'
        AND thread_id IN (${placeholders})
    `
    )
    .run(new Date().toISOString(), ...threadIds);
}

function latestNonActionableMessageSql(threadIdExpression: string) {
  const latestSubject = `
    COALESCE((
      SELECT lower(messages.subject)
      FROM messages
      WHERE messages.thread_id = ${threadIdExpression}
      ORDER BY COALESCE(messages.sent_at, messages.received_at, messages.created_at) DESC
      LIMIT 1
    ), '')
  `;
  const latestFrom = `
    COALESCE((
      SELECT lower(messages.from_email)
      FROM messages
      WHERE messages.thread_id = ${threadIdExpression}
      ORDER BY COALESCE(messages.sent_at, messages.received_at, messages.created_at) DESC
      LIMIT 1
    ), '')
  `;

  return `
    ${latestSubject} LIKE '%wordpress.org thread:%'
    OR ${latestSubject} LIKE '%[wordpress.org]%'
    OR ${latestFrom} LIKE '%wordpress.org%'
  `;
}

function actionableTargetSql(targetAlias: string) {
  const status = `lower(COALESCE(${targetAlias}.status, ''))`;
  const dedupeKey = `lower(COALESCE(${targetAlias}.dedupe_key, ''))`;
  const sourceType = `lower(COALESCE(${targetAlias}.source_type, ''))`;
  const sourceUrl = `lower(COALESCE(${targetAlias}.source_url, ''))`;
  const companyName = `lower(COALESCE(${targetAlias}.company_name, ''))`;

  return `
    COALESCE(${targetAlias}.do_not_resend, 0) = 0
    AND ${status} NOT LIKE '%dead%'
    AND ${status} NOT LIKE '%bounced%'
    AND ${status} NOT LIKE '%skipped%'
    AND ${status} NOT LIKE '%blocked%'
    AND ${status} NOT LIKE '%do not send%'
    AND ${dedupeKey} NOT LIKE '%platform:contra%'
    AND ${dedupeKey} NOT LIKE '%platform:codementor%'
    AND ${sourceUrl} NOT LIKE '%platform:contra%'
    AND ${sourceUrl} NOT LIKE '%platform:codementor%'
    AND NOT (
      ${sourceType} = 'platform'
      AND (${companyName} LIKE '%contra%' OR ${companyName} LIKE '%codementor%')
    )
  `;
}

function outboundEvidenceSql(targetIdExpression: string, sourceTypeExpression: string) {
  const sourceType = `lower(COALESCE(${sourceTypeExpression}, ''))`;

  return `
    EXISTS (
      SELECT 1
      FROM threads outbound_threads
      WHERE outbound_threads.target_id = ${targetIdExpression}
        AND outbound_threads.last_outbound_at IS NOT NULL
    )
    OR EXISTS (
      SELECT 1
      FROM events outbound_events
      WHERE outbound_events.entity_type = 'target'
        AND outbound_events.entity_id = ${targetIdExpression}
        AND (
          outbound_events.event_type = 'email_sent'
          OR (
            outbound_events.event_type = 'outreach_logged'
            AND ${sourceType} != 'contact_form'
          )
        )
    )
  `;
}

function replyEvidenceSql(targetIdExpression: string) {
  return `
    EXISTS (
      SELECT 1
      FROM threads reply_threads
      WHERE reply_threads.target_id = ${targetIdExpression}
        AND reply_threads.last_inbound_at IS NOT NULL
    )
    OR EXISTS (
      SELECT 1
      FROM events reply_events
      WHERE reply_events.entity_type = 'target'
        AND reply_events.entity_id = ${targetIdExpression}
        AND reply_events.event_type IN ('reply_received', 'email_received')
    )
  `;
}

export function getFollowups(filter: "due" | "overdue" | "upcoming" | "all" = "all") {
  const db = getDb();
  const now = new Date().toISOString();
  const todayEnd = endOfTodayIso();
  const todayStart = startOfTodayIso();

  const rows = db
    .select({
      id: followupTasks.id,
      targetId: targets.id,
      threadId: followupTasks.threadId,
      companyName: targets.companyName,
      dedupeKey: targets.dedupeKey,
      sourceType: targets.sourceType,
      sourceUrl: targets.sourceUrl,
      contactEmail: contacts.email,
      emailVerificationStatus: contacts.emailVerificationStatus,
      domain: contacts.domain,
      dueAt: followupTasks.dueAt,
      status: followupTasks.status,
      suggestedSubject: followupTasks.suggestedSubject,
      suggestedBody: followupTasks.suggestedBody,
      notificationSentAt: followupTasks.notificationSentAt,
      notificationChannel: followupTasks.notificationChannel,
      targetStatus: targets.status,
      doNotResend: targets.doNotResend,
      lastOutboundAt: threads.lastOutboundAt,
      lastInboundAt: threads.lastInboundAt
    })
    .from(followupTasks)
    .innerJoin(targets, eq(followupTasks.targetId, targets.id))
    .leftJoin(contacts, eq(targets.contactId, contacts.id))
    .leftJoin(threads, eq(followupTasks.threadId, threads.id))
    .where(eq(followupTasks.status, "open"))
    .orderBy(followupTasks.dueAt)
    .all()
    .filter((row) => !isTargetActionBlocked(row));

  if (filter === "due") {
    return rows.filter((row) => row.dueAt <= todayEnd);
  }

  if (filter === "overdue") {
    return rows.filter((row) => row.dueAt < todayStart);
  }

  if (filter === "upcoming") {
    return rows.filter((row) => row.dueAt > now);
  }

  return rows;
}

export function getAnalyticsData(rangeKey: AnalyticsRangeKey = "7d") {
  const db = getDb();
  const sqlite = getSqlite();
  const dailyRange = getAnalyticsDateRange(rangeKey);

  const eventCounts = db
    .select({
      eventType: events.eventType,
      count: sql<number>`count(*)`
    })
    .from(events)
    .groupBy(events.eventType)
    .orderBy(desc(sql`count(*)`))
    .all();

  const sourceCounts = db
    .select({
      sourceType: targets.sourceType,
      count: sql<number>`count(*)`
    })
    .from(targets)
    .groupBy(targets.sourceType)
    .orderBy(desc(sql`count(*)`))
    .all();

  const statusCounts = db
    .select({
      status: targets.status,
      count: sql<number>`count(*)`
    })
    .from(targets)
    .groupBy(targets.status)
    .orderBy(desc(sql`count(*)`))
    .all();

  const metrics = sqlite
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM targets) as totalTargets,
        (SELECT COUNT(*) FROM targets WHERE ${outboundEvidenceSql("targets.id", "targets.source_type")}) as touchedTargets,
        (SELECT COUNT(*) FROM targets WHERE ${replyEvidenceSql("targets.id")}) as repliedTargets,
        (SELECT COUNT(*) FROM targets WHERE source_type = 'contact_form') as formTargets,
        (SELECT COUNT(*) FROM followup_tasks WHERE status = 'open') as openFollowups,
        (SELECT COUNT(*) FROM followup_tasks WHERE status = 'open' AND due_at <= ?) as dueFollowups,
        (SELECT COUNT(*) FROM targets WHERE do_not_resend = 1) as blockedTargets,
        (SELECT COUNT(*) FROM targets WHERE status = 'dead') as deadTargets
    `
    )
    .get(endOfTodayIso()) as {
    totalTargets: number;
    touchedTargets: number;
    repliedTargets: number;
    formTargets: number;
    openFollowups: number;
    dueFollowups: number;
    blockedTargets: number;
    deadTargets: number;
  };

  const sourcePerformance = sqlite
    .prepare(
      `
      SELECT
        targets.source_type as sourceType,
        COUNT(*) as total,
        COUNT(CASE WHEN ${outboundEvidenceSql("targets.id", "targets.source_type")} THEN 1 END) as sent,
        COUNT(CASE WHEN ${replyEvidenceSql("targets.id")} THEN 1 END) as replied,
        COUNT(CASE WHEN targets.status = 'dead' THEN 1 END) as dead
      FROM targets
      GROUP BY targets.source_type
      ORDER BY total DESC
    `
    )
    .all() as Array<{
    sourceType: string;
    total: number;
    sent: number;
    replied: number;
    dead: number;
  }>;

  const recentEvents = sqlite
    .prepare(
      `
      SELECT
        events.id,
        events.event_type as eventType,
        events.created_at as createdAt,
        events.payload_json as payloadJson,
        targets.id as targetId,
        targets.company_name as companyName
      FROM events
      LEFT JOIN targets ON targets.id = events.entity_id
        AND events.entity_type = 'target'
      ORDER BY events.created_at DESC
      LIMIT 10
    `
    )
    .all() as Array<{
    id: string;
    eventType: string;
    createdAt: string;
    payloadJson: string | null;
    targetId: string | null;
    companyName: string | null;
  }>;

  const dailyActivity = getDailyActivity(sqlite, dailyRange.start, dailyRange.end);

  return {
    eventCounts,
    sourceCounts,
    statusCounts,
    metrics,
    sourcePerformance,
    recentEvents,
    dailyActivity,
    dailyRange: {
      key: rangeKey,
      label: dailyRange.label,
      start: dailyRange.start.toISOString(),
      end: dailyRange.end.toISOString()
    }
  };
}

function getDailyActivity(sqlite: ReturnType<typeof getSqlite>, start: Date, end: Date) {
  const buckets = createDailyBuckets(start, end);
  const rows = sqlite
    .prepare(
      `
      SELECT
        entity_id as entityId,
        event_type as eventType,
        payload_json as payloadJson,
        created_at as createdAt
      FROM events
      WHERE created_at >= ?
        AND created_at <= ?
        AND event_type IN (
          'outreach_logged',
          'email_sent',
          'form_submitted',
          'reply_received',
          'email_received',
          'email_bounced',
          'bounced',
          'followup_sent'
        )
      ORDER BY created_at ASC
    `
    )
    .all(start.toISOString(), end.toISOString()) as Array<{
    entityId: string;
    eventType: string;
    payloadJson: string | null;
    createdAt: string;
  }>;

  const seenOutboundTargets = new Set(
    (
      sqlite
        .prepare(
          `
          SELECT DISTINCT entity_id as entityId
          FROM events
          WHERE created_at < ?
            AND event_type IN ('outreach_logged', 'email_sent', 'form_submitted', 'followup_sent')
        `
        )
        .all(start.toISOString()) as Array<{ entityId: string }>
    ).map((row) => row.entityId)
  );
  const followupMessageKeys = new Set(
    rows
      .filter((row) => row.eventType === "followup_sent")
      .map((row) => eventMessageKey(row))
      .filter((value): value is string => Boolean(value))
  );
  const targetKey = (row: { entityId: string; eventType: string; createdAt: string }) =>
    row.entityId || `${row.eventType}:${row.createdAt}`;

  for (const row of rows) {
    const key = dateKey(new Date(row.createdAt));
    const bucket = buckets.get(key);

    if (!bucket) {
      continue;
    }

    if (
      row.eventType === "outreach_logged" ||
      row.eventType === "form_submitted"
    ) {
      const key = targetKey(row);

      bucket.outreached.add(key);
      seenOutboundTargets.add(key);
      continue;
    }

    if (row.eventType === "email_sent") {
      const key = targetKey(row);

      if (followupMessageKeys.has(eventMessageKey(row) ?? "")) {
        bucket.followups.add(key);
        seenOutboundTargets.add(key);
        continue;
      }

      if (!seenOutboundTargets.has(key)) {
        bucket.outreached.add(key);
        seenOutboundTargets.add(key);
        continue;
      }

      if (!bucket.outreached.has(key)) {
        bucket.followups.add(key);
      }

      continue;
    }

    if (row.eventType === "reply_received" || row.eventType === "email_received") {
      bucket.replied.add(targetKey(row));
      continue;
    }

    if (row.eventType === "email_bounced" || row.eventType === "bounced") {
      bucket.bounced.add(targetKey(row));
      continue;
    }

    if (row.eventType === "followup_sent") {
      const key = targetKey(row);

      bucket.followups.add(key);
      seenOutboundTargets.add(key);
    }
  }

  return Array.from(buckets.values()).map((bucket) => ({
    date: bucket.date,
    label: bucket.label,
    outreached: bucket.outreached.size,
    replied: bucket.replied.size,
    bounced: bucket.bounced.size,
    followups: bucket.followups.size,
    total:
      bucket.outreached.size +
      bucket.replied.size +
      bucket.bounced.size +
      bucket.followups.size
  }));
}

function createDailyBuckets(start: Date, end: Date) {
  const buckets = new Map<
    string,
    {
      date: string;
      label: string;
      outreached: Set<string>;
      replied: Set<string>;
      bounced: Set<string>;
      followups: Set<string>;
    }
  >();
  const cursor = startOfDay(start);

  while (cursor <= end) {
    const key = dateKey(cursor);
    buckets.set(key, {
      date: key,
      label: formatShortDay(cursor),
      outreached: new Set(),
      replied: new Set(),
      bounced: new Set(),
      followups: new Set()
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return buckets;
}

function eventMessageKey(row: { entityId: string; payloadJson: string | null }) {
  const payload = parseEventPayload(row.payloadJson);
  const messageId = typeof payload?.messageId === "string" ? payload.messageId : "";

  return messageId ? `${row.entityId}:${messageId}` : null;
}

function parseEventPayload(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getAnalyticsDateRange(rangeKey: AnalyticsRangeKey) {
  const now = new Date();

  if (rangeKey === "14d") {
    return {
      key: rangeKey,
      label: "2 weeks",
      start: daysAgoStart(13, now),
      end: endOfDay(now)
    };
  }

  if (rangeKey === "this_month") {
    return {
      key: rangeKey,
      label: "This month",
      start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
      end: endOfDay(now)
    };
  }

  if (rangeKey === "last_month") {
    return {
      key: rangeKey,
      label: "Last month",
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0),
      end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
    };
  }

  if (rangeKey === "30d") {
    return {
      key: rangeKey,
      label: "Last 30 days",
      start: daysAgoStart(29, now),
      end: endOfDay(now)
    };
  }

  return {
    key: "7d",
    label: "7 days",
    start: daysAgoStart(6, now),
    end: endOfDay(now)
  };
}

export function getAnalyticsRangeKey(value: string | undefined): AnalyticsRangeKey {
  return analyticsRangeOptions.some((option) => option.key === value)
    ? (value as AnalyticsRangeKey)
    : "7d";
}

function daysAgoStart(days: number, from: Date) {
  const date = new Date(from);
  date.setDate(date.getDate() - days);
  return startOfDay(date);
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatShortDay(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric"
  }).format(date);
}

export function getModuleSettings() {
  return getDb()
    .select()
    .from(moduleSettings)
    .orderBy(moduleSettings.key)
    .all();
}

export function getSendTarget(targetId: string | undefined) {
  if (!targetId) {
    return null;
  }

  const row = getSqlite()
    .prepare(
      `
      SELECT
        targets.id,
        targets.company_name as companyName,
        targets.dedupe_key as dedupeKey,
        targets.do_not_resend as doNotResend,
        targets.source_type as sourceType,
        targets.source_url as sourceUrl,
        targets.status,
        contacts.email as contactEmail,
        contacts.email_verification_status as emailVerificationStatus,
        contacts.email_verification_checked_at as emailVerificationCheckedAt,
        contacts.email_verification_error as emailVerificationError,
        contacts.name as contactName,
        threads.last_outbound_at as lastOutboundAt,
        threads.subject,
        (
          SELECT messages.from_email
          FROM messages
          INNER JOIN threads message_threads ON message_threads.id = messages.thread_id
          WHERE message_threads.target_id = targets.id
            AND messages.direction = 'outbound'
            AND messages.from_email IS NOT NULL
            AND trim(messages.from_email) != ''
          ORDER BY COALESCE(messages.sent_at, messages.created_at) DESC
          LIMIT 1
        ) as lastOutboundFrom,
        (
          SELECT messages.body_text
          FROM messages
          INNER JOIN threads message_threads ON message_threads.id = messages.thread_id
          WHERE message_threads.target_id = targets.id
            AND messages.direction = 'outbound'
            AND messages.body_text IS NOT NULL
            AND trim(messages.body_text) != ''
          ORDER BY COALESCE(messages.sent_at, messages.created_at) DESC
          LIMIT 1
        ) as lastOutboundBody
      FROM targets
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      LEFT JOIN threads ON threads.target_id = targets.id
      WHERE targets.id = ?
      ORDER BY threads.updated_at DESC
      LIMIT 1
    `
    )
    .get(targetId) as
    | {
        id: string;
        companyName: string;
        dedupeKey: string;
        doNotResend: number;
        sourceType: string;
        sourceUrl: string | null;
        status: string;
        contactEmail: string | null;
        emailVerificationStatus: string | null;
        emailVerificationCheckedAt: string | null;
        emailVerificationError: string | null;
        contactName: string | null;
        lastOutboundAt: string | null;
        lastOutboundFrom: string | null;
        subject: string | null;
        lastOutboundBody: string | null;
      }
    | undefined;

  return row ? { ...row, doNotResend: Boolean(row.doNotResend) } : null;
}
