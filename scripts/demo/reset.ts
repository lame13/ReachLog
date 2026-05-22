import fs from "node:fs";

async function main() {
  process.env.DEMO_MODE = "true";
  process.env.SEED_DEMO_DATA = "true";

  const { env } = await import("../../src/modules/core/env");

  if (!isDemoDatabasePath(env.DATABASE_PATH)) {
    throw new Error(
      `Refusing to reset non-demo database path: ${env.DATABASE_PATH}. Set DATABASE_PATH to a demo path first.`
    );
  }

  for (const filePath of [
    env.DATABASE_PATH,
    `${env.DATABASE_PATH}-wal`,
    `${env.DATABASE_PATH}-shm`
  ]) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
    }
  }

  fs.mkdirSync(env.BACKUP_DIR, { recursive: true });

  const { getSqlite } = await import("../../src/modules/core/db/client");
  getSqlite();

  console.log(`Demo database reset and seeded: ${env.DATABASE_PATH}`);
}

function isDemoDatabasePath(value: string) {
  return (
    value.includes("/demo/") ||
    value.includes(".data/demo") ||
    value.endsWith("/demo.sqlite") ||
    value.endsWith("\\demo.sqlite")
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
