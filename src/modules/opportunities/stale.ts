import type BetterSqlite3 from "better-sqlite3";

export type StaleOpportunity = {
  targetId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  activityAt: string;
  total: number;
};

export function findStaleOpportunities({
  sqlite,
  days,
  now = new Date(),
  limit = 20,
  includeNotified = false
}: {
  sqlite: BetterSqlite3.Database;
  days: number;
  now?: Date;
  limit?: number;
  includeNotified?: boolean;
}) {
  const cutoff = new Date(now.getTime() - Math.max(1, days) * 86_400_000)
    .toISOString();

  return sqlite
    .prepare(
      `
      WITH candidates AS (
        SELECT
          targets.id as targetId,
          targets.company_name as companyName,
          contacts.name as contactName,
          contacts.email as contactEmail,
          targets.stale_notified_at as notifiedAt,
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
          ) as activityAt
        FROM targets
        LEFT JOIN contacts ON contacts.id = targets.contact_id
        WHERE targets.stage NOT IN ('won', 'lost')
          AND trim(COALESCE(targets.next_step, '')) = ''
      )
      SELECT targetId, companyName, contactName, contactEmail, activityAt, COUNT(*) OVER () as total
      FROM candidates
      WHERE activityAt <= ?
        AND (? OR notifiedAt IS NULL OR notifiedAt < activityAt)
      ORDER BY activityAt ASC, companyName COLLATE NOCASE ASC, targetId ASC
      LIMIT ?
    `
    )
    .all(cutoff, Number(includeNotified), limit) as StaleOpportunity[];
}
