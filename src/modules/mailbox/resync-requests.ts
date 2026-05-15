import { env } from "@/modules/core/env";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";

const MAIL_RESYNC_JOB_TYPE = "mail_resync";

type PendingMailResyncJob = {
  id: string;
  payloadJson: string | null;
};

export type PendingMailResyncRequest = {
  days: number;
  jobIds: string[];
};

export function requestMailResync({
  days = env.IMAP_AUTO_RESYNC_DAYS,
  reason
}: {
  days?: number;
  reason: string;
}) {
  const resyncDays = normalizeDays(days);

  if (resyncDays <= 0) {
    return false;
  }

  const sqlite = getSqlite();
  const now = new Date().toISOString();

  const existing = sqlite
    .prepare(
      `
      SELECT id, payload_json as payloadJson
      FROM jobs
      WHERE type = ?
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `
    )
    .get(MAIL_RESYNC_JOB_TYPE) as PendingMailResyncJob | undefined;

  if (existing) {
    const payload = parsePayload(existing.payloadJson);

    sqlite
      .prepare(
        `
        UPDATE jobs
        SET payload_json = ?,
            run_at = ?,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        JSON.stringify({
          days: Math.max(normalizeDays(payload.days), resyncDays),
          reasons: uniqueStrings([...(toStringArray(payload.reasons)), reason]),
          requestedAt: now
        }),
        now,
        now,
        existing.id
      );

    return true;
  }

  sqlite
    .prepare(
      `
      INSERT INTO jobs (
        id, type, payload_json, status, run_at, attempts,
        last_error, created_at, updated_at
      )
      VALUES (?, ?, ?, 'pending', ?, 0, NULL, ?, ?)
    `
    )
    .run(
      createId("job"),
      MAIL_RESYNC_JOB_TYPE,
      JSON.stringify({
        days: resyncDays,
        reasons: [reason],
        requestedAt: now
      }),
      now,
      now,
      now
    );

  return true;
}

export function getPendingMailResyncRequest(): PendingMailResyncRequest {
  const now = new Date().toISOString();
  const rows = getSqlite()
    .prepare(
      `
      SELECT id, payload_json as payloadJson
      FROM jobs
      WHERE type = ?
        AND status = 'pending'
        AND run_at <= ?
      ORDER BY created_at ASC
    `
    )
    .all(MAIL_RESYNC_JOB_TYPE, now) as PendingMailResyncJob[];

  return {
    days: rows.reduce((max, row) => {
      const payload = parsePayload(row.payloadJson);

      return Math.max(max, normalizeDays(payload.days));
    }, 0),
    jobIds: rows.map((row) => row.id)
  };
}

export function completeMailResyncRequests(jobIds: string[]) {
  if (!jobIds.length) {
    return;
  }

  const placeholders = jobIds.map(() => "?").join(", ");

  getSqlite()
    .prepare(
      `
      UPDATE jobs
      SET status = 'completed',
          updated_at = ?
      WHERE id IN (${placeholders})
    `
    )
    .run(new Date().toISOString(), ...jobIds);
}

function parsePayload(value: string | null) {
  if (!value) {
    return {} as Record<string, unknown>;
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeDays(value: unknown) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.floor(numberValue)
    : 0;
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
