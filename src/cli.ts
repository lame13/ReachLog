#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import { verifyBackupFile } from "./modules/core/db/verify-backup";

const usage = `ReachLog — keep track of outreach, replies and follow-ups.

Usage:
  reachlog [start] [options]
  reachlog demo [options]
  reachlog worker <name> [options]
  reachlog verify-backup <file>

Options:
  --port <number>       Local port (default: 3000; or PORT)
  --host <address>      Bind address (default: 127.0.0.1)
  --data-dir <path>     Persistent data folder (default: ~/.reachlog)
  --env-file <path>     Configuration file (default: <data-dir>/.env)
  --no-scheduler       Use external worker scheduling instead
  --help               Show this help
  --version            Print the installed version

Workers: mail-sync, mail-resync, list-mailboxes, followup-check,
         email-verify, backup

verify-backup checks a compressed backup before you restore it.
Demo uses its own database and never sends email or notifications.
Workers run once. Enable built-in schedules and configure connections in Settings.
Scheduled tasks run only while ReachLog is running.`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "data-dir": { type: "string" },
      "env-file": { type: "string" },
      "no-scheduler": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" }
    }
  });
  if (values.help || positionals[0] === "help") {
    console.log(usage);
    return;
  }
  if (values.version) {
    console.log(packageVersion());
    return;
  }

  const command = positionals[0] ?? "start";
  if (command === "verify-backup") {
    const file = positionals[1];
    if (!file || positionals.length > 2) {
      throw new Error("Usage: reachlog verify-backup <backup-file>");
    }
    reportBackupVerification(file);
    return;
  }
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
  // Public demo access is opt-in; the request proxy blocks writes in demo mode.
  const publicDemo = demo && process.env.REACHLOG_DEMO_PUBLIC === "true";
  if (command !== "worker" && (!isLocal(host) || !isLocal(publicHostname)) && !authEnabled && !publicDemo) {
    throw new Error(
      "Network access requires APP_BASIC_AUTH_ENABLED=true and credentials. Use the default localhost address for private local use, or REACHLOG_DEMO_PUBLIC=true to publish a read-only demo."
    );
  }

  const appDir = path.join(__dirname, "app");
  if (command !== "worker" && !existsSync(path.join(appDir, ".next/BUILD_ID"))) {
    throw new Error("The application build is missing. From the source checkout, run npm run build first.");
  }
  if (command !== "worker") await assertPortAvailable(host, port);
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
    REACHLOG_DATA_DIR: dataDir,
    REACHLOG_CONNECTIONS_PATH: path.join(dataDir, demo ? "demo-connections.json" : "connections.json"),
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
  console.log(`ReachLog${demo ? " demo" : ""} ${packageVersion()} · data: ${database}`);
  if (publicDemo) {
    console.log("Public read-only demo: every request that could add, change, import or send anything is refused.");
  }
  if (command !== "worker") console.log(
    [
      "",
      `  Open   ${appUrl}`,
      "  Stop   press Ctrl+C",
      demo
        ? "  Demo   sample data; nothing is sent and connections stay off"
        : "  Try it first?  npx reachlog demo  (separate database)"
    ].join("\n")
  );
  const child = spawn(process.execPath, args, { env: childEnv, cwd: dataDir, stdio: "inherit" });
  let stopping = false;
  let scheduler: ReturnType<typeof spawn> | undefined;
  let restartTimer: NodeJS.Timeout | undefined;
  let restartDelay = 1000;
  function startBackground() {
    if (stopping) return;
    scheduler = spawn(process.execPath, [path.join(__dirname, "workers", "scheduler.cjs")], {
      env: childEnv, cwd: dataDir, stdio: ["ignore", "inherit", "inherit", "ipc"]
    });
    scheduler.on("error", () => console.error("Could not start background scheduling. Retrying."));
    scheduler.on("close", () => {
      if (stopping) return;
      restartTimer = setTimeout(startBackground, restartDelay);
      restartDelay = Math.min(restartDelay * 2, 30_000);
    });
  }
  if (command !== "worker" && !demo && !values["no-scheduler"] && process.env.REACHLOG_SCHEDULER_ENABLED !== "false") startBackground();
  function stopBackground() {
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    scheduler?.kill("SIGTERM");
  }
  const signals = ["SIGINT", "SIGTERM"] as const;
  for (const signal of signals) process.on(signal, () => { stopBackground(); child.kill(signal); });
  child.on("error", (error) => {
    stopBackground();
    console.error(`Could not start ReachLog: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    stopBackground();
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  });
}

function reportBackupVerification(file: string) {
  const result = verifyBackupFile(file);
  const count = (value: number | null) =>
    value === null ? "missing" : String(value);

  console.log(`Backup verified: ${result.file}`);
  console.log(`  Integrity check: ${result.integrity}`);
  console.log(
    `  Schema version: ${result.schemaVersion ?? "unknown"}${
      result.schemaName ? ` (${result.schemaName})` : ""
    }`
  );
  console.log(
    `  Records: contacts ${count(result.counts.contacts)}, targets ${count(
      result.counts.targets
    )}, threads ${count(result.counts.threads)}, messages ${count(
      result.counts.messages
    )}, open follow-ups ${count(result.counts.openFollowups)}, outbound sends ${count(
      result.counts.outboundSends
    )}`
  );

  if (result.integrity !== "ok") {
    process.exitCode = 1;
  }
}

function packageVersion() {
  const pkg: { version: string } = JSON.parse(
    readFileSync(path.join(__dirname, "../package.json"), "utf8")
  );
  return pkg.version;
}

/**
 * Fails before starting Next.js so a busy port reports one actionable line
 * instead of a raw EADDRINUSE stack trace.
 */
async function assertPortAvailable(host: string, port: number) {
  const alternatePort = port < 1024 || port === 65535 ? 3000 : port + 1;
  const retryHint = `Run the same command with --port ${alternatePort}, keeping your other options.`;
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use on ${host}. Stop the other process or choose another port. ${retryHint}`
          )
        );
        return;
      }
      if (error.code === "EACCES" || error.code === "EPERM") {
        reject(
          new Error(
            `This system did not allow ReachLog to listen on ${host}:${port}. Ports below 1024 may require extra permissions. ${retryHint}`
          )
        );
        return;
      }
      if (error.code === "EADDRNOTAVAIL" || error.code === "ENOTFOUND") {
        reject(
          new Error(
            `Cannot bind to ${host}. Use the default local address with --host 127.0.0.1.`
          )
        );
        return;
      }
      reject(error);
    });
    probe.listen({ host, port }, () => probe.close(() => resolve()));
  });
}

main().catch((error) => {
  console.error(`ReachLog: ${error instanceof Error ? error.message : "Could not start."}`);
  process.exitCode = 1;
});
