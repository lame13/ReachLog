import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../src/modules/core/env";

function main() {
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

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
