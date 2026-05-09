import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@/modules/core/db/client";
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

export function getDashboardData() {
  const db = getDb();
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
    .orderBy(desc(messages.createdAt))
    .limit(6)
    .all();

  return {
    stats: {
      repliesNeedingAction: replyCount?.count ?? 0,
      followupsDue: followupDueCount?.count ?? 0,
      overdueFollowups: overdueCount?.count ?? 0,
      sentNoReply: sentNoReplyCount?.count ?? 0
    },
    replies,
    followups,
    recentMessages
  };
}

export function getTargets() {
  const db = getDb();

  return db
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
        .orderBy(messages.createdAt)
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

  return {
    eventCounts,
    sourceCounts,
    statusCounts
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
        contactEmail: contacts.email,
        contactName: contacts.name,
        lastOutboundAt: threads.lastOutboundAt,
        subject: threads.subject
      })
      .from(targets)
      .leftJoin(contacts, eq(targets.contactId, contacts.id))
      .leftJoin(threads, eq(targets.id, threads.targetId))
      .where(eq(targets.id, targetId))
      .get() ?? null
  );
}
