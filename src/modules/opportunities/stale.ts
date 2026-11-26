import type BetterSqlite3 from "better-sqlite3";

export type StaleOpportunity = {
  targetId: string;
  companyName: string;
  activityAt: string;
};

export function findStaleOpportunities({
  sqlite,
  days,
  now = new Date(),
  limit = 20
}: {
  sqlite: BetterSqlite3.Database;
  days: number;
  now?: Date;
  limit?: number;
}) {
  const cutoff = new Date(now.getTime() - Math.max(1, days) * 86_400_000)
    .toISOString();

  return sqlite
    .prepare(
      `
      SELECT
        targets.id as targetId,
        targets.company_name as companyName,
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
      WHERE targets.stage NOT IN ('won', 'lost')
        AND (
          trim(COALESCE(targets.next_step, '')) = ''
          OR targets.next_step_at IS NULL
        )
        AND MAX(
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
        ) <= ?
        AND (
          targets.stale_notified_at IS NULL
          OR targets.stale_notified_at < MAX(
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
          )
        )
      ORDER BY activityAt ASC, targets.company_name COLLATE NOCASE ASC
      LIMIT ?
    `
    )
    .all(cutoff, limit) as StaleOpportunity[];
}
