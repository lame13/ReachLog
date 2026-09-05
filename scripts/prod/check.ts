import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { env } from "../../src/modules/core/env";

type Check = {
  label: string;
  ok: boolean;
  detail?: string;
};

const checks: Check[] = [
  checkDemoDatabasePath(),
  checkWritablePath("DATABASE_PATH parent", dirname(resolve(env.DATABASE_PATH))),
  checkWritableFileOrParent("DATABASE_PATH", resolve(env.DATABASE_PATH)),
  checkWritablePath("BACKUP_DIR", resolve(env.BACKUP_DIR)),
  env.DEMO_MODE
    ? pass("rclone", "skipped in demo mode")
    : env.B2_REMOTE
      ? checkCommand("rclone")
      : pass("rclone", "skipped because B2_REMOTE is empty"),
  checkProductionAuth(),
  checkSeedMode(),
  checkSmtpConfig(),
  checkImapConfig(),
  checkEmailListVerifyConfig()
];

let failed = false;

for (const check of checks) {
  const prefix = check.ok ? "PASS" : "FAIL";
  console.log(`${prefix} ${check.label}${check.detail ? ` - ${check.detail}` : ""}`);

  if (!check.ok) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}

function pass(label: string, detail?: string): Check {
  return { label, ok: true, detail };
}

function fail(label: string, detail: string): Check {
  return { label, ok: false, detail };
}

function checkDemoDatabasePath(): Check {
  if (!env.DEMO_MODE) {
    return pass("DEMO_MODE", "false");
  }

  if (
    env.DATABASE_PATH.includes("/demo/") ||
    env.DATABASE_PATH.includes(".data/demo") ||
    env.DATABASE_PATH.endsWith("/demo.sqlite") ||
    env.DATABASE_PATH.endsWith("\\demo.sqlite")
  ) {
    return pass("DEMO_MODE", `true using ${env.DATABASE_PATH}`);
  }

  return fail(
    "DEMO_MODE",
    `true but DATABASE_PATH does not look like a demo database: ${env.DATABASE_PATH}`
  );
}

function checkWritablePath(label: string, path: string): Check {
  try {
    if (!existsSync(path)) {
      return fail(label, `${path} does not exist`);
    }

    const stats = statSync(path);

    if (!stats.isDirectory()) {
      return fail(label, `${path} is not a directory`);
    }

    accessSync(path, constants.W_OK);
    return pass(label, path);
  } catch (error) {
    return fail(label, error instanceof Error ? error.message : "not writable");
  }
}

function checkWritableFileOrParent(label: string, path: string): Check {
  try {
    if (existsSync(path)) {
      accessSync(path, constants.W_OK);
      return pass(label, path);
    }

    accessSync(dirname(path), constants.W_OK);
    return pass(label, `${path} can be created`);
  } catch (error) {
    return fail(label, error instanceof Error ? error.message : "not writable");
  }
}

function checkCommand(command: string): Check {
  const result = spawnSync("which", [command], { encoding: "utf8" });

  if (result.status !== 0) {
    return fail(command, "not found in PATH");
  }

  return pass(command, result.stdout.trim());
}

function checkProductionAuth(): Check {
  if (env.DEMO_MODE) {
    return pass("Basic Auth", "not required for demo mode");
  }

  if (process.env.NODE_ENV !== "production") {
    return pass("Basic Auth", "not enforced because NODE_ENV is not production");
  }

  if (!env.APP_BASIC_AUTH_ENABLED) {
    return fail("Basic Auth", "APP_BASIC_AUTH_ENABLED must be true in production");
  }

  if (!env.APP_BASIC_AUTH_USER || !env.APP_BASIC_AUTH_PASSWORD) {
    return fail("Basic Auth", "APP_BASIC_AUTH_USER and APP_BASIC_AUTH_PASSWORD are required");
  }

  if (env.APP_BASIC_AUTH_PASSWORD === "CHANGE_ME_LONG_RANDOM_PASSWORD") {
    return fail("Basic Auth", "replace the placeholder password");
  }

  return pass("Basic Auth", env.APP_BASIC_AUTH_USER);
}

function checkSeedMode(): Check {
  if (env.DEMO_MODE) {
    return pass("SEED_DEMO_DATA", "demo mode seeds sample data");
  }

  if (env.SEED_DEMO_DATA) {
    return fail("SEED_DEMO_DATA", "must be false before production import");
  }

  return pass("SEED_DEMO_DATA", "false");
}

function checkSmtpConfig(): Check {
  if (env.DEMO_MODE) {
    return pass("SMTP config", "disabled by demo mode");
  }

  if (!env.SMTP_ENABLED) {
    return pass("SMTP config", "disabled");
  }

  const missing = [
    env.SMTP_USER ? null : "SMTP_USER",
    env.SMTP_PASS ? null : "SMTP_PASS",
    env.SMTP_FROM ? null : "SMTP_FROM"
  ].filter(Boolean);

  if (missing.length) {
    return fail("SMTP config", `${missing.join(", ")} required when SMTP_ENABLED=true`);
  }

  return pass(
    "SMTP config",
    `${env.SMTP_HOST}:${env.SMTP_PORT} secure=${String(env.SMTP_SECURE)}`
  );
}

function checkImapConfig(): Check {
  if (env.DEMO_MODE) {
    return pass("IMAP config", "disabled by demo mode");
  }

  if (!env.IMAP_ENABLED) {
    return pass("IMAP config", "disabled");
  }

  const missing = [
    env.IMAP_USER ? null : "IMAP_USER",
    env.IMAP_PASS ? null : "IMAP_PASS"
  ].filter(Boolean);

  if (missing.length) {
    return fail("IMAP config", `${missing.join(", ")} required when IMAP_ENABLED=true`);
  }

  return pass(
    "IMAP config",
    `${env.IMAP_HOST}:${env.IMAP_PORT} security=${env.IMAP_SECURITY ?? (env.IMAP_SECURE ? "tls" : "auto")} tlsVerify=${String(env.IMAP_TLS_VERIFY)}`
  );
}

function checkEmailListVerifyConfig(): Check {
  if (env.DEMO_MODE) {
    return pass("EmailListVerify config", "disabled by demo mode");
  }

  if (!env.EMAILLISTVERIFY_ENABLED) {
    return pass("EmailListVerify config", "disabled");
  }

  if (!env.EMAILLISTVERIFY_API_KEY) {
    return fail(
      "EmailListVerify config",
      "EMAILLISTVERIFY_API_KEY required when EMAILLISTVERIFY_ENABLED=true"
    );
  }

  return pass(
    "EmailListVerify config",
    `enabled batch=${env.EMAILLISTVERIFY_BATCH_SIZE} timeout=${env.EMAILLISTVERIFY_TIMEOUT_MS}ms`
  );
}
