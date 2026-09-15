import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";

type SqliteDatabase = Database.Database;

export type BackupVerification = {
  file: string;
  integrity: string;
  schemaVersion: string | null;
  schemaName: string | null;
  counts: {
    contacts: number | null;
    targets: number | null;
    threads: number | null;
    messages: number | null;
    openFollowups: number | null;
    outboundSends: number | null;
  };
};

/**
 * Reads a compressed ReachLog backup without touching the live database, so a
 * restore can be checked before it replaces anything. Only reads: the extracted
 * copy is deleted again before this returns.
 */
export function verifyBackupFile(file: string): BackupVerification {
  if (!existsSync(file)) {
    throw new Error(`Backup file not found: ${file}`);
  }

  const directory = mkdtempSync(path.join(tmpdir(), "reachlog-verify-"));
  const databasePath = path.join(directory, "app.sqlite");

  try {
    let contents: Buffer;

    try {
      contents = gunzipSync(readFileSync(file));
    } catch {
      throw new Error(
        "That file is not a gzip-compressed backup. Choose a .sqlite.gz file created by ReachLog."
      );
    }

    writeFileSync(databasePath, contents, { mode: 0o600 });

    const database = openReadOnly(databasePath);

    try {
      const integrity = readIntegrity(database);
      if (integrity !== "ok") {
        throw new Error(`SQLite integrity check failed: ${integrity}`);
      }
      const migration = tableExists(database, "schema_migrations")
        ? (database
            .prepare(
              "SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1"
            )
            .get() as { version: string; name: string } | undefined)
        : undefined;

      const counts = {
        contacts: countRows(database, "contacts"),
        targets: countRows(database, "targets"),
        threads: countRows(database, "threads"),
        messages: countRows(database, "messages"),
        openFollowups: countRows(database, "followup_tasks", "status = 'open'"),
        outboundSends: countRows(database, "outbound_sends")
      };
      if (!migration?.version || Object.values(counts).some((count) => count === null)) {
        throw new Error("This is not a complete ReachLog backup: required tables or migration history are missing.");
      }

      return {
        file: path.resolve(file),
        integrity,
        schemaVersion: migration?.version ?? null,
        schemaName: migration?.name ?? null,
        counts
      };
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function openReadOnly(databasePath: string) {
  try {
    return new Database(databasePath, { readonly: true, fileMustExist: true });
  } catch {
    throw new Error(
      "The decompressed file is not a readable SQLite database. The backup may be truncated."
    );
  }
}

function readIntegrity(database: SqliteDatabase) {
  try {
    return String(database.pragma("integrity_check", { simple: true }));
  } catch {
    throw new Error("SQLite could not check this backup. It may be damaged or truncated.");
  }
}

function tableExists(database: SqliteDatabase, table: string) {
  return Boolean(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  );
}

function countRows(database: SqliteDatabase, table: string, where?: string) {
  if (!tableExists(database, table)) {
    return null;
  }

  return (
    database
      .prepare(
        `SELECT COUNT(*) as count FROM ${table}${where ? ` WHERE ${where}` : ""}`
      )
      .get() as { count: number }
  ).count;
}
