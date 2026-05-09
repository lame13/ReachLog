import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
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

export type TargetListItem = Awaited<ReturnType<typeof getTargets>>[number];
export type FollowupListItem = Awaited<ReturnType<typeof getFollowups>>[number];
export type TargetFilters = {
  q?: string;
  status?: string;
  source?: string;
  domain?: string;
  flag?: string;
};

export function getDashboardData() {
  const db = getDb();
  const sqlite = getSqlite();
  const todayEnd = endOfTodayIso();

  const [replyCount] = db
    .select({ count: sql<number>`count(*)` })
    .from(threads)
    .where(eq(threads.status, "replied"))
    .all();

  const [followupDueCount] = db
    .select({ count: sql<number>`count(*)` })
    .from(followupTasks)
    .where(and(eq(followupTasks.status, "open"), lte(followupTasks.dueAt, todayEnd)))
    .all();

  const [overdueCount] = db
    .select({ count: sql<number>`count(*)` })
    .from(followupTasks)
    .where(
      and(
        eq(followupTasks.status, "open"),
        lte(followupTasks.dueAt, startOfTodayIso())
      )
    )
    .all();

  const [sentNoReplyCount] = db
    .select({ count: sql<number>`count(*)` })
    .from(threads)
    .where(eq(threads.status, "waiting"))
    .all();

  const replies = db
    .select({
      threadId: threads.id,
      targetId: targets.id,
      companyName: targets.companyName,
      contactName: contacts.name,
      contactEmail: contacts.email,
      lastInboundAt: threads.lastInboundAt,
      status: threads.status
    })
    .from(threads)
    .innerJoin(targets, eq(threads.targetId, targets.id))
    .leftJoin(contacts, eq(threads.contactId, contacts.id))
    .where(eq(threads.status, "replied"))
    .orderBy(desc(threads.lastInboundAt))
    .limit(5)
    .all();

  const followups = getFollowups("due").slice(0, 5);

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
      repliesNeedingAction: replyCount?.count ?? 0,
      followupsDue: followupDueCount?.count ?? 0,
      overdueFollowups: overdueCount?.count ?? 0,
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
  const db = getDb();

  const rows = db
    .select({
      id: targets.id,
      companyName: targets.companyName,
      websiteUrl: targets.websiteUrl,
      sourceType: targets.sourceType,
      sourceUrl: targets.sourceUrl,
      dedupeKey: targets.dedupeKey,
      status: targets.status,
      doNotResend: targets.doNotResend,
      updatedAt: targets.updatedAt,
      contactName: contacts.name,
      contactEmail: contacts.email,
      domain: contacts.domain
    })
    .from(targets)
    .leftJoin(contacts, eq(targets.contactId, contacts.id))
    .orderBy(desc(targets.updatedAt))
    .all();

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
        .orderBy(sql`COALESCE(${messages.sentAt}, ${messages.receivedAt}, ${messages.createdAt})`)
        .all()
    : [];

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
      contactEmail: contacts.email,
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
    .all();

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

export function getAnalyticsData() {
  const db = getDb();
  const sqlite = getSqlite();

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
        (SELECT COUNT(DISTINCT target_id) FROM threads WHERE last_outbound_at IS NOT NULL) as touchedTargets,
        (SELECT COUNT(DISTINCT target_id) FROM threads WHERE last_inbound_at IS NOT NULL) as repliedTargets,
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
        COUNT(DISTINCT targets.id) as total,
        COUNT(DISTINCT CASE WHEN threads.last_outbound_at IS NOT NULL THEN targets.id END) as sent,
        COUNT(DISTINCT CASE WHEN threads.last_inbound_at IS NOT NULL THEN targets.id END) as replied,
        COUNT(DISTINCT CASE WHEN targets.status = 'dead' THEN targets.id END) as dead
      FROM targets
      LEFT JOIN threads ON threads.target_id = targets.id
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

  return {
    eventCounts,
    sourceCounts,
    statusCounts,
    metrics,
    sourcePerformance,
    recentEvents
  };
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

  const db = getDb();
  return (
    db
      .select({
        id: targets.id,
        companyName: targets.companyName,
        doNotResend: targets.doNotResend,
        status: targets.status,
        contactEmail: contacts.email,
        contactName: contacts.name,
        lastOutboundAt: threads.lastOutboundAt,
        subject: threads.subject
      })
      .from(targets)
      .leftJoin(contacts, eq(targets.contactId, contacts.id))
      .leftJoin(threads, eq(targets.id, threads.targetId))
      .where(eq(targets.id, targetId))
      .orderBy(desc(threads.updatedAt))
      .limit(1)
      .get() ?? null
  );
}
