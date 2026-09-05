#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";

const usage = `ReachLog — keep track of outreach, replies and follow-ups.

Usage:
  reachlog [start] [options]
  reachlog demo [options]
  reachlog worker <name> [options]

Options:
  --port <number>       Local port (default: 3000; or PORT)
  --host <address>      Bind address (default: 127.0.0.1)
  --data-dir <path>     Persistent data folder (default: ~/.reachlog)
  --env-file <path>     Configuration file (default: <data-dir>/.env)
  --help               Show this help
  --version            Print the installed version

Workers: mail-sync, mail-resync, list-mailboxes, followup-check,
         email-verify, backup

Demo uses its own database and never sends email or notifications.
Workers run once. Schedule them separately if needed.`;

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "data-dir": { type: "string" },
      "env-file": { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" }
    }
  });
  if (values.help || positionals[0] === "help") {
    console.log(usage);
    return;
  }
  if (values.version) {
    const pkg: { version: string } = JSON.parse(
      readFileSync(path.join(__dirname, "../package.json"), "utf8")
    );
    console.log(pkg.version);
    return;
  }

  const command = positionals[0] ?? "start";
  const workerNames = new Set([
    "mail-sync", "mail-resync", "list-mailboxes", "followup-check", "email-verify", "backup"
  ]);
  if (!["start", "demo", "worker"].includes(command)) {
    throw new Error(`Unknown command: ${command}. Run reachlog --help.`);
  }
  const worker = positionals[1];
  if (command === "worker" ? !workerNames.has(worker) || positionals.length !== 2 : positionals.length > 1) {
    throw new Error("Invalid arguments. Run reachlog --help for commands and worker names.");
  }

  const dataDir = path.resolve(values["data-dir"] ?? process.env.REACHLOG_DATA_DIR ?? path.join(homedir(), ".reachlog"));
  const envFile = path.resolve(values["env-file"] ?? path.join(dataDir, ".env"));
  if (values["env-file"] && !existsSync(envFile)) {
    throw new Error(`Configuration file not found: ${envFile}`);
  }
  if (existsSync(envFile)) {
    const result = loadEnv({ path: envFile });
    if (result.error) throw new Error(`Could not read configuration file: ${envFile}`);
  }

  const demo = command === "demo" || process.env.DEMO_MODE === "true";
  const port = Number(values.port ?? process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be an integer between 1 and 65535.");
  }
  const host = values.host ?? process.env.REACHLOG_HOST ?? "127.0.0.1";
  const isLocal = (hostname: string) => ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname);
  const appUrl = process.env.APP_URL ?? `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
  let publicHostname: string;
  try {
    const url = new URL(appUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    publicHostname = url.hostname;
  } catch {
    throw new Error("APP_URL must be an http or https URL.");
  }
  const authEnabled = process.env.APP_BASIC_AUTH_ENABLED === "true";
  const password = process.env.APP_BASIC_AUTH_PASSWORD;
  if (authEnabled && (!process.env.APP_BASIC_AUTH_USER || !password || password === "CHANGE_ME_LONG_RANDOM_PASSWORD")) {
    throw new Error("Set APP_BASIC_AUTH_USER and a real APP_BASIC_AUTH_PASSWORD before starting with authentication.");
  }
  if (command !== "worker" && (!isLocal(host) || !isLocal(publicHostname)) && !authEnabled) {
    throw new Error("Network access requires APP_BASIC_AUTH_ENABLED=true and credentials. Use the default localhost address for private local use.");
  }

  const appDir = path.join(__dirname, "app");
  if (command !== "worker" && !existsSync(path.join(appDir, ".next/BUILD_ID"))) {
    throw new Error("The application build is missing. From the source checkout, run npm run build first.");
  }
  process.umask(0o077);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const database = demo ? path.join(dataDir, "demo.sqlite") : path.resolve(dataDir, process.env.DATABASE_PATH ?? "app.sqlite");
  const backups = demo ? path.join(dataDir, "demo-backups") : path.resolve(dataDir, process.env.BACKUP_DIR ?? "backups");
  mkdirSync(path.dirname(database), { recursive: true, mode: 0o700 });
  mkdirSync(backups, { recursive: true, mode: 0o700 });
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DOTENV_CONFIG_PATH: envFile,
    DATABASE_PATH: database,
    BACKUP_DIR: backups,
    APP_URL: appUrl,
    DEMO_MODE: String(demo),
    SEED_DEMO_DATA: String(demo)
  };
  if (demo) {
    for (const key of ["SMTP_ENABLED", "IMAP_ENABLED", "TELEGRAM_ENABLED", "EMAILLISTVERIFY_ENABLED"] as const) {
      childEnv[key] = "false";
    }
  }
  if (worker === "mail-resync") {
    childEnv.MAIL_SYNC_RESYNC_DAYS = process.env.MAIL_SYNC_RESYNC_DAYS ?? "30";
  }
  const args = command === "worker"
    ? [path.join(__dirname, "workers", `${worker === "mail-resync" ? "mail-sync" : worker}.cjs`)]
    : [require.resolve("next/dist/bin/next"), "start", appDir, "--hostname", host, "--port", String(port)];
  console.log(`ReachLog${demo ? " demo" : ""} · data: ${database}`);
  const child = spawn(process.execPath, args, { env: childEnv, cwd: dataDir, stdio: "inherit" });
  const signals = ["SIGINT", "SIGTERM"] as const;
  for (const signal of signals) process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    console.error(`Could not start ReachLog: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  });
}

try {
  main();
} catch (error) {
  console.error(`ReachLog: ${error instanceof Error ? error.message : "Could not start."}`);
  process.exitCode = 1;
}
