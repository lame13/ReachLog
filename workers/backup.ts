import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../src/modules/core/env";
import { getSqlite } from "../src/modules/core/db/client";
import { withWorkerLock } from "../src/modules/core/db/locks";
import { notifyWorkerFailure } from "../src/modules/core/worker-alerts";

async function main() {
  if (env.DEMO_MODE) {
    console.log("backup skipped: DEMO_MODE=true");
    return;
  }

  await withWorkerLock("backup", 1800, runBackup);
}

async function runBackup() {
  getSqlite();
  fs.mkdirSync(env.BACKUP_DIR, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(env.BACKUP_DIR, `app-${date}.sqlite`);
  const gzipPath = `${backupPath}.gz`;

  execFileSync("sqlite3", [
    env.DATABASE_PATH,
    `VACUUM INTO '${backupPath.replaceAll("'", "''")}';`
  ]);

  execFileSync("gzip", ["-f", backupPath]);

  if (env.B2_REMOTE) {
    execFileSync("rclone", ["copy", env.BACKUP_DIR, env.B2_REMOTE], {
      stdio: "inherit"
    });
  }

  console.log(`backup written: ${gzipPath}`);
}

main().catch(async (error) => {
  console.error(error);
  await notifyWorkerFailure("backup", error);
  process.exitCode = 1;
});
