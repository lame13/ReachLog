import { getSqlite } from "../core/db/client";
import { env } from "../core/env";
import { type Schedule, type ScheduleName } from "./definitions";

export class ScheduleInputError extends Error {}

export function getSchedules(): Schedule[] {
  return getSqlite()
    .prepare(
      `SELECT name, enabled, interval_minutes AS intervalMinutes,
    next_run_at AS nextRunAt, last_started_at AS lastStartedAt, last_finished_at AS lastFinishedAt,
    last_success_at AS lastSuccessAt, last_status AS lastStatus, last_error AS lastError
    FROM background_schedules ORDER BY CASE name WHEN 'mail-sync' THEN 0 WHEN 'followup-check' THEN 1 WHEN 'ai' THEN 2 ELSE 3 END`,
    )
    .all() as Schedule[];
}

export function scheduleBlocker(name: ScheduleName) {
  if (env.DEMO_MODE) return "Background tasks are off in demo mode.";
  if (
    name === "mail-sync" &&
    (!env.IMAP_ENABLED || !env.IMAP_HOST || !env.IMAP_USER || !env.IMAP_PASS)
  )
    return "Connect and enable mailbox sync first.";
  if (
    name === "followup-check" &&
    (!env.TELEGRAM_ENABLED || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID)
  )
    return "Connect and enable Telegram first.";
  if (name === "ai" && (!env.AI_ENABLED || !env.AI_BASE_URL || !env.AI_MODEL))
    return "Configure and enable AI automation in Settings first.";
  return null;
}

export function schedulerIsRunning(now = new Date().toISOString()) {
  if (env.DEMO_MODE) return false;
  return Boolean(
    getSqlite()
      .prepare(
        "SELECT 1 FROM worker_locks WHERE name = 'scheduler' AND lease_until > ?",
      )
      .get(now),
  );
}

export function updateSchedule(
  name: ScheduleName,
  enabled: boolean,
  intervalMinutes: number,
  now = new Date(),
) {
  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 1 ||
    intervalMinutes > 10080
  )
    throw new ScheduleInputError(
      "Choose an interval from 1 to 10,080 minutes.",
    );
  if (env.DEMO_MODE)
    throw new ScheduleInputError("Background tasks are off in demo mode.");
  const blocker = scheduleBlocker(name);
  if (enabled && blocker) throw new ScheduleInputError(blocker);
  const next = enabled
    ? new Date(now.getTime() + intervalMinutes * 60_000).toISOString()
    : null;
  getSqlite()
    .prepare(
      "UPDATE background_schedules SET enabled = ?, interval_minutes = ?, next_run_at = ?, updated_at = ? WHERE name = ?",
    )
    .run(Number(enabled), intervalMinutes, next, now.toISOString(), name);
}

export function requestScheduleRun(name: ScheduleName, now = new Date()) {
  const blocker = scheduleBlocker(name);
  if (blocker) throw new ScheduleInputError(blocker);
  if (!schedulerIsRunning(now.toISOString()))
    throw new ScheduleInputError(
      "The scheduler is not running. Start ReachLog with background scheduling enabled.",
    );
  const result = getSqlite()
    .prepare(
      "UPDATE background_schedules SET next_run_at = ?, updated_at = ? WHERE name = ? AND enabled = 1 AND last_status != 'running'",
    )
    .run(now.toISOString(), now.toISOString(), name);
  if (!result.changes)
    throw new ScheduleInputError(
      "Enable this schedule first, or wait for the current run to finish.",
    );
}

export function claimSchedule(name: ScheduleName, now = new Date()) {
  const sqlite = getSqlite();
  return (
    sqlite
      .prepare(
        `UPDATE background_schedules SET last_status = 'running', last_started_at = ?,
    next_run_at = NULL, updated_at = ? WHERE name = ? AND enabled = 1 AND last_status != 'running'
    AND next_run_at IS NOT NULL AND next_run_at <= ?`,
      )
      .run(now.toISOString(), now.toISOString(), name, now.toISOString())
      .changes > 0
  );
}

export function finishSchedule(
  name: ScheduleName,
  status: "success" | "failed" | "skipped" | "interrupted",
  message: string | null,
  now = new Date(),
) {
  const sqlite = getSqlite();
  sqlite.transaction(() => {
    const row = sqlite
      .prepare(
        "SELECT enabled, interval_minutes AS minutes, next_run_at AS nextRunAt FROM background_schedules WHERE name = ?",
      )
      .get(name) as {
      enabled: number;
      minutes: number;
      nextRunAt: string | null;
    };
    const next = row.enabled
      ? (row.nextRunAt ??
        new Date(now.getTime() + row.minutes * 60_000).toISOString())
      : null;
    sqlite
      .prepare(
        `UPDATE background_schedules SET last_status = ?, last_error = ?, last_finished_at = ?,
      last_success_at = CASE WHEN ? = 'success' THEN ? ELSE last_success_at END, next_run_at = ?, updated_at = ? WHERE name = ?`,
      )
      .run(
        status,
        message,
        now.toISOString(),
        status,
        now.toISOString(),
        next,
        now.toISOString(),
        name,
      );
  })();
}

export function recoverInterruptedSchedules(now = new Date()) {
  getSqlite()
    .prepare(
      `UPDATE background_schedules SET last_status = 'interrupted',
    last_error = 'The previous run was interrupted. It will be retried when enabled.',
    last_finished_at = ?, next_run_at = CASE WHEN enabled = 1 THEN ? ELSE NULL END
    WHERE last_status = 'running'`,
    )
    .run(now.toISOString(), now.toISOString());
}
