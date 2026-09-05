import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

export async function backupDatabase(sqlite: Database.Database, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const file = path.resolve(directory, `app-${stamp}-${randomUUID().slice(0, 8)}.sqlite.gz`);
  const snapshot = `${file}.sqlite.tmp`;
  const compressed = `${file}.tmp`;
  try {
    await sqlite.backup(snapshot);
    await pipeline(createReadStream(snapshot), createGzip(), createWriteStream(compressed, { mode: 0o600, flags: "wx" }));
    await rename(compressed, file);
    return file;
  } finally {
    await rm(snapshot, { force: true });
    await rm(compressed, { force: true });
  }
}
