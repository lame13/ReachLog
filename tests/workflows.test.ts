import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net, { type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

async function mailServer(protocol: "smtp" | "imap", reject = false) {
  const sockets = new Set<Socket>();
  const commands: string[] = [];
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.write(
      protocol === "smtp"
        ? "220 localhost test SMTP\r\n"
        : "* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] localhost test IMAP\r\n",
    );
    let buffer = "";
    let authenticating = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes("\r\n")) {
        const index = buffer.indexOf("\r\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        commands.push(line);
        if (protocol === "smtp") {
          if (/^EHLO/.test(line))
            socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
          else if (/^AUTH/.test(line))
            socket.write(
              reject
                ? "535 private-password authentication failed\r\n"
                : "235 Authentication successful\r\n",
            );
          else if (/^QUIT/.test(line)) socket.end("221 Bye\r\n");
          else socket.write("500 Unexpected SMTP command\r\n");
        } else if (authenticating) {
          socket.write(
            `${authenticating} ${reject ? "NO private-password authentication failed" : "OK authenticated"}\r\n`,
          );
          authenticating = "";
        } else {
          const [tag, command, ...rest] = line.split(" ");
          if (command === "CAPABILITY")
            socket.write(
              `* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n${tag} OK capability\r\n`,
            );
          else if (command === "AUTHENTICATE") {
            if (rest.length > 1)
              socket.write(
                `${tag} ${reject ? "NO login failed" : "OK authenticated"}\r\n`,
              );
            else {
              authenticating = tag;
              socket.write("+\r\n");
            }
          } else if (command === "LOGIN")
            socket.write(
              `${tag} ${reject ? "NO login failed" : "OK authenticated"}\r\n`,
            );
          else if (command === "LIST" && rest.join(" ") === '"" ""')
            socket.write(
              `* LIST (\\Noselect) "/" ""\r\n${tag} OK namespace\r\n`,
            );
          else if (command === "LIST" || command === "LSUB")
            socket.write(
              `* ${command} (\\HasNoChildren) "/" "INBOX"\r\n* ${command} (\\HasNoChildren) "/" "Sent"\r\n* ${command} (\\HasNoChildren) "/" "Archive"\r\n${tag} OK list\r\n`,
            );
          else if (command === "LOGOUT")
            socket.end(`* BYE closing\r\n${tag} OK logout\r\n`);
          else socket.write(`${tag} BAD unsupported\r\n`);
        }
      }
    });
  });
  await new Promise<void>((resolve, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    port: address.port,
    commands,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function until(predicate: () => boolean, message: string) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await delay(25);
  }
  assert.fail(message);
}

test("0.2.0 workflows", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "reachlog-workflows-"));
  for (const key of Object.keys(process.env))
    if (/^(SMTP_|IMAP_|TELEGRAM_|EMAILLISTVERIFY_|REACHLOG_)/.test(key))
      delete process.env[key];
  Object.assign(process.env, {
    DATABASE_PATH: path.join(directory, "app.sqlite"),
    BACKUP_DIR: path.join(directory, "backups"),
    REACHLOG_CONNECTIONS_PATH: path.join(directory, "connections.json"),
    DEMO_MODE: "false",
    SEED_DEMO_DATA: "false",
    B2_REMOTE: "",
  });
  const { getSqlite } = await import("../src/modules/core/db/client");
  const { bootstrapDatabase } = await import(
    "../src/modules/core/db/bootstrap"
  );
  const connections = await import("../src/modules/connections/store");
  const checks = await import("../src/modules/connections/check");
  const { getRuntimeEnv } = await import("../src/modules/core/env");
  const schedules = await import("../src/modules/scheduler/store");
  const { startScheduler } = await import("../src/modules/scheduler/runner");
  const locks = await import("../src/modules/core/db/locks");
  const templates = await import("../src/modules/templates/store");
  const { renderTemplate, unresolvedVariables } = await import(
    "../src/modules/templates/render"
  );
  const sqlite = getSqlite();
  t.after(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await t.test(
    "upgrade preserves existing records, drafts, and prior migrations",
    () => {
      const old = new Database(path.join(directory, "upgrade.sqlite"));
      try {
        bootstrapDatabase(old);
        old.exec(
          "DROP TABLE email_templates; DROP TABLE background_schedules; DELETE FROM schema_migrations WHERE version = '0007'",
        );
        old
          .prepare(
            "INSERT INTO targets (id, company_name, source_type, dedupe_key, status, created_at, updated_at) VALUES ('existing', 'Existing company', 'manual', 'existing', 'new', '2026-01-01', '2026-01-01')",
          )
          .run();
        old
          .prepare(
            "INSERT INTO email_drafts VALUES ('existing', 'Keep subject', 'Keep body', 'owner@example.test', '2026-01-01')",
          )
          .run();
        const migrations = old
          .prepare(
            "SELECT * FROM schema_migrations WHERE version < '0007' ORDER BY version",
          )
          .all();
        bootstrapDatabase(old);
        bootstrapDatabase(old);
        assert.deepEqual(
          old
            .prepare(
              "SELECT * FROM schema_migrations WHERE version < '0007' ORDER BY version",
            )
            .all(),
          migrations,
        );
        assert.equal(
          (
            old.prepare("SELECT body FROM email_drafts").get() as {
              body: string;
            }
          ).body,
          "Keep body",
        );
        assert.equal(
          (
            old.prepare("SELECT count(*) AS count FROM targets").get() as {
              count: number;
            }
          ).count,
          1,
        );
        assert.equal(
          (
            old
              .prepare(
                "SELECT count(*) AS count FROM background_schedules WHERE enabled = 0",
              )
              .get() as { count: number }
          ).count,
          4,
        );
        assert.deepEqual(old.pragma("foreign_key_check"), []);
        assert.equal(old.pragma("integrity_check", { simple: true }), "ok");
      } finally {
        old.close();
      }
    },
  );

  const smtp = (port = 1025) =>
    form({
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(port),
      SMTP_USER: "owner",
      SMTP_PASS: "private-password",
      SMTP_FROM: "Owner <owner@example.test>",
      SMTP_SECURITY: "plain",
      SMTP_TLS_VERIFY: "true",
      SMTP_ENABLED: "true",
    });
  await t.test(
    "connection saves are private, validated, persistent, and update the runtime immediately",
    () => {
      assert.equal(connections.getConnectionView("smtp").configured, false);
      const view = connections.saveConnection("smtp", smtp());
      assert.equal(view.enabled, true);
      assert.equal(view.configured, true);
      assert.equal(view.secrets.SMTP_PASS, true);
      assert.equal(JSON.stringify(view).includes("private-password"), false);
      assert.equal(getRuntimeEnv().SMTP_USER, "owner");
      assert.equal(getRuntimeEnv().SMTP_ENABLED, true);
      if (process.platform !== "win32")
        assert.equal(
          statSync(connections.connectionsPath()).mode & 0o777,
          0o600,
        );
      const update = smtp();
      update.set("SMTP_PASS", "");
      update.set("SMTP_USER", "updated-owner");
      connections.saveConnection("smtp", update);
      assert.equal(getRuntimeEnv().SMTP_PASS, "private-password");
      assert.equal(getRuntimeEnv().SMTP_USER, "updated-owner");
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--eval",
          "import('./src/modules/core/env.ts').then(m => console.log((m.getRuntimeEnv ?? m.default.getRuntimeEnv)().SMTP_USER))",
        ],
        { cwd: process.cwd(), env: process.env, encoding: "utf8" },
      );
      assert.equal(child.status, 0, child.stderr);
      assert.match(child.stdout, /updated-owner/);
      const invalid = smtp();
      invalid.set("SMTP_PORT", "70000");
      assert.throws(
        () => connections.saveConnection("smtp", invalid),
        connections.ConnectionInputError,
      );
      assert.equal(getRuntimeEnv().SMTP_PORT, 1025);
      process.env.SMTP_PASS = "environment-secret";
      const locked = connections.saveConnection("smtp", smtp());
      assert.ok(locked.overridden.includes("SMTP_PASS"));
      assert.equal(getRuntimeEnv().SMTP_PASS, "environment-secret");
      assert.ok(
        !readFileSync(connections.connectionsPath(), "utf8").includes(
          "environment-secret",
        ),
      );
      delete process.env.SMTP_PASS;
    },
  );

  await t.test(
    "SMTP verifies login without sending mail, and invalidates stale checks",
    async () => {
      const server = await mailServer("smtp");
      try {
        connections.saveConnection("smtp", smtp(server.port));
        const view = await checks.testConnection("smtp");
        assert.equal(view.check?.ok, true, view.check?.message);
        assert.ok(server.commands.some((line) => line.startsWith("AUTH")));
        assert.ok(
          !server.commands.some((line) => /^(MAIL|RCPT|DATA)/.test(line)),
        );
        assert.ok(!JSON.stringify(view).includes("fingerprint"));
        const fingerprint = connections.connectionFingerprint("smtp");
        const updated = smtp(server.port);
        updated.set("SMTP_PASS", "replacement-password");
        connections.saveConnection("smtp", updated);
        assert.equal(connections.getConnectionView("smtp").check, null);
        assert.equal(
          connections.recordConnectionCheck("smtp", {
            fingerprint,
            checkedAt: new Date().toISOString(),
            ok: true,
            message: "old",
          }),
          false,
        );
      } finally {
        await server.close();
      }
      const rejected = await mailServer("smtp", true);
      try {
        connections.saveConnection("smtp", smtp(rejected.port));
        const view = await checks.testConnection("smtp");
        assert.equal(view.check?.ok, false);
        assert.ok(!JSON.stringify(view).includes("private-password"));
      } finally {
        await rejected.close();
      }
    },
  );

  await t.test(
    "IMAP discovers mailboxes and flags unavailable selections without importing mail",
    async () => {
      const server = await mailServer("imap");
      const input = form({
        IMAP_HOST: "127.0.0.1",
        IMAP_PORT: String(server.port),
        IMAP_USER: "owner",
        IMAP_PASS: "private-password",
        IMAP_SECURITY: "plain",
        IMAP_TLS_VERIFY: "true",
        IMAP_MAILBOXES: "INBOX,Missing",
        IMAP_ENABLED: "true",
      });
      try {
        connections.saveConnection("imap", input);
        const missing = await checks.testConnection("imap");
        assert.equal(missing.check?.ok, false);
        assert.deepEqual([...(missing.check?.mailboxes ?? [])].sort(), [
          "Archive",
          "INBOX",
          "Sent",
        ]);
        input.set("IMAP_MAILBOXES", "INBOX,Sent");
        input.set("IMAP_PASS", "");
        connections.saveConnection("imap", input);
        const passed = await checks.testConnection("imap");
        assert.equal(passed.check?.ok, true, passed.check?.message);
        assert.ok(
          !server.commands.some((line) =>
            /\b(FETCH|STORE|APPEND|EXPUNGE)\b/.test(line),
          ),
        );
      } finally {
        await server.close();
      }
    },
  );

  await t.test(
    "Telegram checks bot and chat without sending a notification; demo blocks connections",
    async () => {
      const requested: string[] = [];
      await checks.checkTelegramConnection(
        "123:test-token",
        "42",
        async (url) => {
          requested.push(String(url));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      );
      assert.equal(requested.length, 2);
      assert.match(requested[0], /getMe$/);
      assert.match(requested[1], /getChat\?chat_id=42$/);
      await assert.rejects(
        checks.checkTelegramConnection(
          "123:test-token",
          "42",
          async () =>
            new Response(JSON.stringify({ ok: false }), { status: 200 }),
        ),
      );
      process.env.DEMO_MODE = "true";
      await assert.rejects(checks.testConnection("smtp"), /demo mode/);
      assert.equal(
        schedules.scheduleBlocker("backup"),
        "Background tasks are off in demo mode.",
      );
      process.env.DEMO_MODE = "false";
    },
  );

  await t.test(
    "templates preserve text, support updates and deletion, and flag missing or unknown variables",
    () => {
      const id = templates.saveTemplate(null, {
        name: "Introduction",
        subject: "Hello {{company}}",
        body: "Hi {{contact_name}},\nYour site: {{website}} — café.",
      });
      const saved = templates.getTemplates().find((item) => item.id === id);
      assert.ok(saved);
      const rendered = renderTemplate(saved, {
        company: "Example & Sons",
        contact_name: "Alex",
        website: null,
        email: "alex@example.test",
      });
      assert.equal(rendered.subject, "Hello Example & Sons");
      assert.deepEqual(rendered.missing, ["website"]);
      assert.match(rendered.body, /— café/);
      assert.throws(
        () =>
          templates.saveTemplate(null, {
            name: "introduction",
            subject: "Hello",
            body: "Text",
          }),
        templates.TemplateInputError,
      );
      assert.throws(
        () =>
          templates.saveTemplate(null, {
            name: "Bad",
            subject: "Hi {{unknown}}",
            body: "Text",
          }),
        templates.TemplateInputError,
      );
      assert.throws(
        () =>
          templates.saveTemplate(null, {
            name: "Bad",
            subject: "Header\r\nBcc: other@example.test",
            body: "Text",
          }),
        templates.TemplateInputError,
      );
      assert.deepEqual(unresolvedVariables("Hi {{company"), [
        "incomplete variable",
      ]);
      templates.saveTemplate(id, {
        name: "Updated",
        subject: "Hi {{company}}",
        body: "Revised\nmessage",
      });
      assert.equal(
        templates.getTemplates().find((item) => item.id === id)?.body,
        "Revised\nmessage",
      );
      templates.deleteTemplate(id);
      assert.equal(templates.getTemplates().length, 0);
    },
  );

  await t.test(
    "schedule state handles opt-in, intervals, failures, pausing, and interrupted runs",
    () => {
      assert.ok(
        schedules.getSchedules().every((schedule) => !schedule.enabled),
      );
      assert.throws(() => schedules.updateSchedule("backup", true, 0));
      const now = new Date("2026-01-01T00:00:00Z");
      schedules.updateSchedule("backup", true, 5, now);
      assert.equal(schedules.claimSchedule("backup", now), false);
      assert.equal(
        schedules.claimSchedule("backup", new Date(now.getTime() + 300000)),
        true,
      );
      assert.equal(
        schedules.claimSchedule("backup", new Date(now.getTime() + 300000)),
        false,
      );
      schedules.finishSchedule("backup", "success", null, now);
      const success = schedules
        .getSchedules()
        .find((row) => row.name === "backup")?.lastSuccessAt;
      schedules.finishSchedule("backup", "failed", "Test failure", now);
      assert.equal(
        schedules.getSchedules().find((row) => row.name === "backup")
          ?.lastSuccessAt,
        success,
      );
      schedules.updateSchedule("backup", false, 5, now);
      schedules.finishSchedule("backup", "success", null, now);
      assert.equal(
        schedules.getSchedules().find((row) => row.name === "backup")
          ?.nextRunAt,
        null,
      );
      sqlite
        .prepare(
          "UPDATE background_schedules SET last_status = 'running' WHERE name = 'backup'",
        )
        .run();
      schedules.recoverInterruptedSchedules(now);
      assert.equal(
        schedules.getSchedules().find((row) => row.name === "backup")
          ?.lastStatus,
        "interrupted",
      );
    },
  );

  await t.test(
    "worker leases exclude competing owners and renew without stealing",
    async () => {
      assert.equal(locks.acquireWorkerLock("test-lock", "one", 10), true);
      assert.equal(locks.acquireWorkerLock("test-lock", "two", 10), false);
      assert.equal(locks.renewWorkerLock("test-lock", "two", 10), false);
      assert.equal(locks.renewWorkerLock("test-lock", "one", 10), true);
      locks.releaseWorkerLock("test-lock", "two");
      assert.equal(locks.acquireWorkerLock("test-lock", "two", 10), false);
      sqlite
        .prepare(
          "UPDATE worker_locks SET lease_until = '2000-01-01' WHERE name = 'test-lock'",
        )
        .run();
      assert.equal(locks.acquireWorkerLock("test-lock", "two", 10), true);
      locks.releaseWorkerLock("test-lock", "two");
      let count = 0;
      const results = await Promise.all([
        locks.withWorkerLock("exclusive", 10, async () => {
          count++;
          await delay(30);
        }),
        locks.withWorkerLock("exclusive", 10, async () => {
          count++;
        }),
      ]);
      assert.equal(count, 1);
      assert.ok(results.includes(null));
    },
  );

  await t.test(
    "two schedulers run a due task once, retain success, report failure, and shut down children",
    async () => {
      const workers = path.join(directory, "workers");
      mkdirSync(workers);
      const marker = path.join(directory, "runs.txt");
      writeFileSync(
        path.join(workers, "backup.cjs"),
        `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'run\\n')`,
      );
      const stopFirst = startScheduler({
        workerDirectory: workers,
        tickMs: 20,
      });
      const stopSecond = startScheduler({
        workerDirectory: workers,
        tickMs: 20,
      });
      try {
        schedules.updateSchedule("backup", true, 60);
        schedules.requestScheduleRun("backup");
        await until(
          () =>
            schedules.getSchedules().find((row) => row.name === "backup")
              ?.lastStatus === "success",
          "Scheduled worker did not finish",
        );
        assert.equal(readFileSync(marker, "utf8"), "run\n");
        const success = schedules
          .getSchedules()
          .find((row) => row.name === "backup")?.lastSuccessAt;
        writeFileSync(
          path.join(workers, "backup.cjs"),
          "console.error('private-password'); process.exitCode = 1;",
        );
        schedules.requestScheduleRun("backup");
        await until(
          () =>
            schedules.getSchedules().find((row) => row.name === "backup")
              ?.lastStatus === "failed",
          "Failure was not recorded",
        );
        const failed = schedules
          .getSchedules()
          .find((row) => row.name === "backup");
        assert.equal(failed?.lastSuccessAt, success);
        assert.ok(!failed?.lastError?.includes("private-password"));
        writeFileSync(
          path.join(workers, "backup.cjs"),
          "setInterval(() => {}, 1000)",
        );
        schedules.requestScheduleRun("backup");
        await until(
          () =>
            schedules.getSchedules().find((row) => row.name === "backup")
              ?.lastStatus === "running",
          "Worker did not start",
        );
      } finally {
        await stopSecond();
        await stopFirst();
      }
      assert.equal(schedules.schedulerIsRunning(), false);
      assert.equal(
        schedules.getSchedules().find((row) => row.name === "backup")
          ?.lastStatus,
        "interrupted",
      );
    },
  );

  await t.test(
    "scheduler recovers after sleep and yields safely to a successor",
    async () => {
      const workers = path.join(directory, "recovery-workers");
      mkdirSync(workers);
      const marker = path.join(directory, "worker-pid.txt");
      const worker = path.join(workers, "backup.cjs");
      writeFileSync(
        worker,
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000);`,
      );
      const stop = startScheduler({ workerDirectory: workers, tickMs: 20 });
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      try {
        schedules.updateSchedule("backup", true, 60);
        schedules.requestScheduleRun("backup");
        await until(
          () => existsSync(marker),
          "Worker did not start before sleep",
        );
        const originalPid = Number(readFileSync(marker, "utf8"));
        sqlite
          .prepare(
            "UPDATE worker_locks SET lease_until = '2000-01-01' WHERE name = 'scheduler'",
          )
          .run();
        await until(
          () => Number(readFileSync(marker, "utf8")) !== originalPid,
          "Scheduler did not resume after its lease expired",
        );
        assert.equal(alive(originalPid), false);
        const resumedPid = Number(readFileSync(marker, "utf8"));

        schedules.updateSchedule("backup", false, 60);
        sqlite
          .prepare(
            "UPDATE worker_locks SET owner = 'test-successor', lease_until = '2999-01-01' WHERE name = 'scheduler'",
          )
          .run();
        await until(
          () => !alive(resumedPid),
          "Former leader did not stop its worker",
        );
        assert.equal(
          schedules.getSchedules().find((row) => row.name === "backup")
            ?.lastStatus,
          "running",
          "Former leader overwrote successor state",
        );
        locks.releaseWorkerLock("scheduler", "test-successor");
        await until(
          () => schedules.schedulerIsRunning(),
          "Scheduler did not regain leadership",
        );
        writeFileSync(worker, "process.exitCode = 0;");
        schedules.updateSchedule("backup", true, 60);
        schedules.requestScheduleRun("backup");
        await until(
          () =>
            schedules.getSchedules().find((row) => row.name === "backup")
              ?.lastStatus === "success",
          "Recovered scheduler did not complete a task",
        );
      } finally {
        locks.releaseWorkerLock("scheduler", "test-successor");
        await stop();
        schedules.updateSchedule("backup", false, 60);
      }
    },
  );
});
