import os from "node:os";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { getSqlite } from "@/modules/core/db/client";

export async function withWorkerLock<T>(
  name: string,
  leaseSeconds: number,
  work: () => Promise<T>
) {
  const owner = `${os.hostname()}:${process.pid}:${randomUUID()}`;

  if (!acquireWorkerLock(name, owner, leaseSeconds)) {
    console.log(`${name} skipped: lock already held`);
    return null;
  }

  const heartbeat = setInterval(() => renewWorkerLock(name, owner, leaseSeconds), Math.max(1000, leaseSeconds * 1000 / 3));
  heartbeat.unref();
  try {
    return await work();
  } finally {
    clearInterval(heartbeat);
    releaseWorkerLock(name, owner);
  }
}

export function acquireWorkerLock(name: string, owner: string, leaseSeconds: number) {
  const sqlite = getSqlite();
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();

  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare(
        `
        INSERT INTO worker_locks (name, owner, locked_at, lease_until, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(name) DO NOTHING
      `
      )
      .run(name, owner, nowIso, leaseUntil, nowIso);

    const lock = sqlite
      .prepare("SELECT owner, lease_until as leaseUntil FROM worker_locks WHERE name = ?")
      .get(name) as { owner: string; leaseUntil: string } | undefined;

    if (!lock) {
      return false;
    }

    if (lock.owner === owner) {
      return true;
    }

    if (lock.leaseUntil > nowIso) {
      return false;
    }

    const changed = sqlite
      .prepare(
        `
        UPDATE worker_locks
        SET owner = ?,
            locked_at = ?,
            lease_until = ?,
            updated_at = ?
        WHERE name = ?
          AND lease_until <= ?
      `
      )
      .run(owner, nowIso, leaseUntil, nowIso, name, nowIso).changes;

    return changed > 0;
  });

  return transaction();
}

export function renewWorkerLock(name: string, owner: string, leaseSeconds: number) {
  const now = new Date();
  return getSqlite().prepare("UPDATE worker_locks SET lease_until = ?, updated_at = ? WHERE name = ? AND owner = ? AND lease_until > ?")
    .run(new Date(now.getTime() + leaseSeconds * 1000).toISOString(), now.toISOString(), name, owner, now.toISOString()).changes > 0;
}

export function releaseWorkerLock(name: string, owner: string) {
  getSqlite()
    .prepare("DELETE FROM worker_locks WHERE name = ? AND owner = ?")
    .run(name, owner);
}
