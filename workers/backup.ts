import { execFileSync } from "node:child_process";
import { env } from "../src/modules/core/env";
import { getSqlite } from "../src/modules/core/db/client";
import { backupDatabase } from "../src/modules/core/db/backup";
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
  const gzipPath = await backupDatabase(getSqlite(), env.BACKUP_DIR);

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
