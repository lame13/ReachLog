import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

// Use an already installed Playwright. This script never downloads tooling or browsers.
const { chromium } = await import(
  process.env.REACHLOG_PLAYWRIGHT_MODULE ?? "playwright"
);
const { expect } = await import(
  process.env.REACHLOG_PLAYWRIGHT_TEST_MODULE ?? "playwright/test"
);
const installed = path.resolve(process.argv[2] ?? ".");
const directory = await mkdtemp(path.join(tmpdir(), "reachlog-browser-"));
const output = path.resolve(
  process.env.REACHLOG_QA_OUTPUT ?? path.join(directory, "evidence"),
);
await mkdir(output, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env))
  if (
    /^(SMTP_|IMAP_|TELEGRAM_|EMAILLISTVERIFY_|REACHLOG_|DATABASE_PATH$|BACKUP_DIR$|DOTENV_CONFIG_PATH$|B2_REMOTE$|APP_BASIC_AUTH_)/.test(
      key,
    )
  )
    delete env[key];
Object.assign(env, {
  NEXT_TELEMETRY_DISABLED: "1",
  DEMO_MODE: "false",
  SEED_DEMO_DATA: "false",
  B2_REMOTE: "",
});
let app;
let appLog = "";
let context;
let page;
const messages = [];
const sockets = new Set();
const smtp = net.createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => {});
  socket.write("220 localhost browser test\r\n");
  let buffer = "",
    data = false,
    content = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("\r\n")) {
      const end = buffer.indexOf("\r\n");
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (data) {
        if (line === ".") {
          messages.push(content);
          content = "";
          data = false;
          socket.write("250 queued locally\r\n");
        } else content += line + "\r\n";
      } else if (/^EHLO/.test(line))
        socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
      else if (/^AUTH/.test(line)) socket.write("235 Authenticated\r\n");
      else if (/^(MAIL FROM|RCPT TO|RSET)/.test(line))
        socket.write("250 OK\r\n");
      else if (/^DATA/.test(line)) {
        data = true;
        socket.write("354 End with dot\r\n");
      } else if (/^QUIT/.test(line)) socket.end("221 Bye\r\n");
      else socket.write("500 Unexpected command\r\n");
    }
  });
});
await new Promise((resolve, reject) => {
  smtp.once("error", reject);
  smtp.listen(0, "127.0.0.1", resolve);
});
const smtpPort = smtp.address().port;
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
env.APP_URL = base;

async function start(overrides = {}) {
  appLog = "";
  app = spawn(
    process.execPath,
    [
      path.join(installed, "dist/cli.cjs"),
      "--port",
      String(port),
      "--data-dir",
      path.join(directory, "data"),
    ],
    { env: { ...env, ...overrides }, stdio: ["ignore", "pipe", "pipe"] },
  );
  app.stdout.on("data", (chunk) => {
    appLog += chunk;
  });
  app.stderr.on("data", (chunk) => {
    appLog += chunk;
  });
  await expect
    .poll(
      async () => {
        if (app.exitCode !== null) throw new Error(appLog);
        try {
          return (await fetch(base + "/dashboard")).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(overrides.APP_BASIC_AUTH_ENABLED === "true" ? 401 : 200);
}
async function stop() {
  if (!app || app.exitCode !== null) return;
  const exited = once(app, "exit");
  app.kill("SIGTERM");
  const timer = setTimeout(() => app.kill("SIGKILL"), 10000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
async function shot(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(output, name + ".png"),
    fullPage: true,
  });
}
async function noOverflow() {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Page overflows horizontally",
  );
}

try {
  await start();
  context = await chromium.launchPersistentContext(
    path.join(directory, "browser-profile"),
    {
      headless: true,
      channel: process.env.REACHLOG_QA_CHROME ? undefined : "chrome",
      executablePath: process.env.REACHLOG_QA_CHROME || undefined,
      viewport: { width: 1440, height: 1000 },
      locale: "en-US",
      timezoneId: "UTC",
    },
  );
  await context.tracing.start({ screenshots: true, snapshots: true });
  page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(`${message.text()} ${message.location().url}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500)
      errors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Start tracking your outreach" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Templates", exact: true }).click();
  await expect(
    page.getByText("No templates yet.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Template name", { exact: true }).fill("Introduction");
  await page
    .getByLabel("Subject", { exact: true })
    .fill("Hello {{unsupported}}");
  await page
    .getByLabel("Body", { exact: true })
    .fill(
      "Hi {{contact_name}},\nLet’s talk about {{company}}.\nWebsite: {{website}}",
    );
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText(/Unknown variables:/)).toBeVisible();
  await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(
    "Introduction",
  );
  await page.getByLabel("Subject", { exact: true }).fill("Hello {{company}}");
  await page.getByRole("button", { name: "Save template" }).click();
  await page.waitForURL(/templates\?edit=/);
  await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(
    "Introduction",
  );
  await page.getByText("Preview with sample contact", { exact: true }).click();
  await expect(
    page.getByText("Hello Example Company", { exact: true }),
  ).toBeVisible();
  await shot("templates-desktop");

  await page.getByRole("link", { name: "Targets", exact: true }).click();
  await page.getByRole("link", { name: "New target", exact: true }).click();
  await page.getByLabel("Company", { exact: true }).fill("Browser Example");
  await page.getByLabel("Contact name", { exact: true }).fill("Alex");
  await page.getByLabel("Email", { exact: true }).fill("alex@example.test");
  await page.getByRole("button", { name: "Create target" }).click();
  await page.waitForURL(/\/targets\/[^/?]+$/);
  const targetId = page.url().split("/").pop();
  const composeUrl = `${base}/targets?sendTargetId=${encodeURIComponent(targetId)}`;
  await page.goto(composeUrl);
  await page
    .getByLabel("Email template", { exact: true })
    .selectOption({ label: "Introduction" });
  await expect(
    page.getByText("Template preview", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use template", exact: true }).click();
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(
    "Hello Browser Example",
  );
  await expect(
    page.getByRole("button", { name: "Send now", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Undo template", exact: true })
    .click();
  await expect(page.getByLabel("Body", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Use template", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft saved. Nothing was sent.", { exact: true }),
  ).toBeVisible();
  await page.goto(composeUrl);
  await expect(page.getByLabel("Body", { exact: true })).toHaveValue(
    /\{\{website\}\}/,
  );
  // Bypass the disabled control to verify the server also rejects unfinished variables.
  await page
    .getByRole("button", { name: "Send now", exact: true })
    .evaluate((button) => {
      button.disabled = false;
      button.click();
    });
  await expect(
    page.getByText(
      "Check the subject and message length, and replace all template variables before sending. Your draft was saved.",
      { exact: true },
    ),
  ).toBeVisible();
  assert.equal(messages.length, 0);
  await page
    .getByLabel("Body", { exact: true })
    .fill("Hi Alex,\nLet’s talk about Browser Example.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft saved. Nothing was sent.", { exact: true }),
  ).toBeVisible();
  await shot("composer-desktop");
  assert.equal(messages.length, 0);
  console.log(
    "PASS: template creation, validation, preview, substitution, undo, missing-variable guard, and saved draft",
  );

  await page
    .getByRole("link", { name: "Close send modal", exact: true })
    .click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const smtpForm = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Email sending", exact: true }),
  });
  await expect(
    smtpForm.getByText("Not configured", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("SMTP host", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("SMTP port", { exact: true }).fill(String(smtpPort));
  await page.getByLabel("SMTP username", { exact: true }).fill("test-owner");
  await page
    .getByLabel("SMTP password", { exact: true })
    .fill("browser-test-password");
  await page
    .getByLabel("Sender email", { exact: true })
    .fill("invalid-address");
  await page
    .getByLabel("SMTP encryption", { exact: true })
    .selectOption("plain");
  await page.getByLabel("Enable email sending", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(
    page.getByText("Enter a valid sender email.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("SMTP password", { exact: true })).toHaveValue(
    "browser-test-password",
  );
  await page
    .getByLabel("Sender email", { exact: true })
    .fill("owner@example.test");
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(
    page.getByText("Connection saved. Changes take effect immediately.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("SMTP password", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    page.getByText("Connection verified", { exact: true }),
  ).toBeVisible();
  assert.equal(messages.length, 0);
  assert.ok(
    !(await (await fetch(base + "/settings/modules")).text()).includes(
      "browser-test-password",
    ),
  );
  await expect(
    page.getByText("Scheduler running", { exact: true }),
  ).toBeVisible();
  const backups = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Database backups", exact: true }),
  });
  await backups
    .getByRole("checkbox", { name: "Enable database backups" })
    .check();
  await backups
    .getByRole("button", { name: "Save schedule", exact: true })
    .click();
  await expect(backups.getByText("Scheduled", { exact: true })).toBeVisible();
  await backups.getByRole("button", { name: "Run now", exact: true }).click();
  await expect(backups.getByText(/Last run:.*\(success\)/)).toBeVisible({
    timeout: 25000,
  });
  await expect(
    backups.getByText("Task queued. It will start within a few seconds.", {
      exact: true,
    }),
  ).toHaveCount(0);
  assert.ok(
    (await readdir(path.join(directory, "data/backups"))).some((file) =>
      file.endsWith(".sqlite.gz"),
    ),
  );
  await shot("settings-desktop");
  console.log(
    "PASS: guided SMTP setup, credential redaction, connection verification, background backup, and live run status",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await shot("settings-mobile");
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("link", { name: "Templates", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Email templates", exact: true }),
  ).toBeVisible();
  await noOverflow();
  await shot("templates-mobile");
  await page.goto(composeUrl);
  await noOverflow();
  await shot("composer-mobile");
  await page
    .getByRole("button", { name: "Save draft", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Send now", exact: true }),
  ).toBeInViewport();
  await shot("composer-mobile-actions");
  console.log(
    "PASS: desktop and mobile navigation, template editor, settings, composer, and no horizontal overflow",
  );

  await stop();
  await start();
  await page.goto(composeUrl);
  await expect(page.getByLabel("Body", { exact: true })).toHaveValue(
    "Hi Alex,\nLet’s talk about Browser Example.",
  );
  await expect(
    page
      .getByLabel("Email template", { exact: true })
      .getByRole("option", { name: "Introduction" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Send now", exact: true }).click();
  await expect.poll(() => messages.length).toBe(1);
  assert.ok(messages[0].includes("Hello Browser Example"));
  assert.ok(!messages[0].includes("{{"));
  console.log(
    "PASS: restart persistence and an explicitly submitted email delivered only to the local SMTP fixture",
  );

  await page.goto(base + "/templates");
  await page
    .getByRole("link", { name: "Introduction Hello {{company}}", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Keep template", exact: true })
    .click();
  await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(
    "Introduction",
  );
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete template", exact: true })
    .click();
  await expect(
    page.getByText("No templates yet.", { exact: false }),
  ).toBeVisible();
  console.log("PASS: named delete confirmation and cancellation");

  await stop();
  await start({
    APP_BASIC_AUTH_ENABLED: "true",
    APP_BASIC_AUTH_USER: "test-owner",
    APP_BASIC_AUTH_PASSWORD: "test-only-auth-password",
  });
  for (const route of [
    "/settings/modules",
    "/templates",
    "/api/export/targets",
  ])
    assert.equal((await fetch(base + route)).status, 401);
  const authorization = `Basic ${Buffer.from("test-owner:test-only-auth-password").toString("base64")}`;
  await context.setExtraHTTPHeaders({ authorization });
  await page.goto(base + "/settings/modules");
  await expect(
    page.getByText("Connection verified", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        ok: true,
        browser: "Chromium",
        desktop: "1440x1000",
        mobile: "390x844",
        consoleErrors: errors,
        localEmails: messages.length,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: authentication protects new pages; no browser errors or failed server responses",
  );
  await context.tracing.stop();
} catch (error) {
  if (page) {
    await shot("failure").catch(() => {});
    await writeFile(
      path.join(output, "failure-dom.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    ).catch(() => {});
  }
  if (context)
    await context.tracing
      .stop({ path: path.join(output, "failure-trace.zip") })
      .catch(() => {});
  await writeFile(path.join(output, "server.log"), appLog);
  throw error;
} finally {
  await context?.close();
  await stop();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => smtp.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
