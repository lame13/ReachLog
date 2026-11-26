import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

async function runAction(
  action: (formData: FormData) => Promise<unknown>,
  values: Record<string, string>
) {
  try {
    await action(form(values));
  } catch (error) {
    assert.match(
      String(error),
      /static generation store missing in revalidatePath|NEXT_REDIRECT/
    );
  }
}

test("1.1 opportunity workflow", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "reachlog-opportunity-"));
  for (const key of Object.keys(process.env)) {
    if (
      /^(SMTP_|IMAP_|TELEGRAM_|EMAILLISTVERIFY_|REACHLOG_|DEMO_|SEED_|AI_|STALE_DEAL_DAYS)/.test(
        key
      )
    ) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, {
    DATABASE_PATH: path.join(directory, "app.sqlite"),
    BACKUP_DIR: path.join(directory, "backups"),
    REACHLOG_CONNECTIONS_PATH: path.join(directory, "connections.json"),
    DEMO_MODE: "false",
    SEED_DEMO_DATA: "false",
    STALE_DEAL_DAYS: "14"
  });

  const { getSqlite } = await import("../src/modules/core/db/client");
  const { bootstrapDatabase } = await import("../src/modules/core/db/bootstrap");
  const opportunities = await import("../src/modules/opportunities/actions");
  const values = await import("../src/modules/opportunities/value");
  const outreachActions = await import("../src/modules/outreach/actions");
  const queries = await import("../src/modules/outreach/queries");
  const pipeline = await import("../src/modules/pipeline/queries");
  const pipelineActions = await import("../src/modules/pipeline/actions");
  const { getExportRows } = await import("../src/modules/export/data");
  const sqlite = getSqlite();

  t.after(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await t.test("money parsing stays exact and validates input", () => {
    assert.equal(values.parseDealValueToCents("1,250.50"), 125050);
    assert.equal(values.parseDealValueToCents("0"), 0);
    assert.equal(values.parseDealValueToCents(""), null);
    assert.equal(values.parseDealValueToCents("-10"), undefined);
    assert.equal(values.parseDealValueToCents("12.345"), undefined);
    assert.equal(values.centsToInputValue(125050), "1250.50");
    assert.equal(values.normalizeCurrency("thb"), "THB");
    assert.equal(values.normalizeCurrency("nope"), "USD");
  });

  await t.test("schema and migration stay idempotent", () => {
    bootstrapDatabase(sqlite);
    const columns = sqlite
      .prepare("PRAGMA table_info(targets)")
      .all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));

    for (const name of [
      "value_cents",
      "currency",
      "expected_close_date",
      "next_step",
      "next_step_at",
      "lost_reason",
      "closed_at"
    ]) {
      assert.equal(names.has(name), true, `${name} exists`);
    }
    assert.equal(
      (
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '0010'"
          )
          .get() as { count: number }
      ).count,
      1
    );
    assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
    assert.equal(sqlite.pragma("integrity_check", { simple: true }), "ok");
  });

  const now = new Date().toISOString();
  sqlite
    .prepare(
      `
      INSERT INTO accounts (id, name, domain, dedupe_key, created_at, updated_at)
      VALUES ('a1', 'Northstar', 'northstar.example', 'domain:northstar.example', ?, ?)
    `
    )
    .run(now, now);
  sqlite
    .prepare(
      `
      INSERT INTO contacts (id, account_id, name, email, domain, created_at, updated_at)
      VALUES ('c1', 'a1', 'Mina', 'mina@northstar.example', 'northstar.example', ?, ?)
    `
    )
    .run(now, now);
  sqlite
    .prepare(
      `
      INSERT INTO targets (
        id, contact_id, account_id, company_name, source_type, dedupe_key,
        status, stage, currency, created_at, updated_at
      )
      VALUES (
        't1', 'c1', 'a1', 'Northstar', 'referral',
        'email:mina@northstar.example', 'replied', 'qualified', 'USD', ?, ?
      )
    `
    )
    .run(now, now);

  await t.test("next steps save, appear in Today data, and can be completed", async () => {
    const dueDate = new Date().toISOString().slice(0, 10);
    await runAction(opportunities.scheduleNextStepAction, {
      targetId: "t1",
      nextStep: "Send the proposal",
      nextStepDate: dueDate
    });

    const saved = sqlite
      .prepare(
        "SELECT next_step AS nextStep, next_step_at AS nextStepAt FROM targets WHERE id = 't1'"
      )
      .get() as { nextStep: string; nextStepAt: string };
    assert.equal(saved.nextStep, "Send the proposal");
    assert.ok(saved.nextStepAt);

    const dashboard = queries.getDashboardData();
    assert.equal(dashboard.stats.nextStepsDue, 1);
    assert.equal(dashboard.nextSteps[0]?.targetId, "t1");

    await runAction(opportunities.completeNextStepAction, {
      targetId: "t1"
    });
    assert.equal(
      (
        sqlite
          .prepare("SELECT next_step AS nextStep FROM targets WHERE id = 't1'")
          .get() as { nextStep: string | null }
      ).nextStep,
      null
    );
  });

  await t.test("editing an opportunity stores value and closing context", async () => {
    await runAction(outreachActions.updateTargetAction, {
      targetId: "t1",
      contactId: "c1",
      companyName: "Northstar",
      contactName: "Mina",
      email: "mina@northstar.example",
      websiteUrl: "https://northstar.example",
      sourceType: "referral",
      status: "replied",
      stage: "won",
      dealValue: "4,250.50",
      currency: "thb",
      expectedCloseDate: "2026-12-15",
      nextStep: "",
      nextStepDate: "",
      lostReason: "",
      dedupeKey: "email:mina@northstar.example"
    });

    const target = sqlite
      .prepare(
        `
        SELECT value_cents AS valueCents, currency, stage, closed_at AS closedAt
        FROM targets WHERE id = 't1'
      `
      )
      .get() as {
      valueCents: number;
      currency: string;
      stage: string;
      closedAt: string | null;
    };
    assert.equal(target.valueCents, 425050);
    assert.equal(target.currency, "THB");
    assert.equal(target.stage, "won");
    assert.ok(target.closedAt);
    assert.ok(pipeline.getPipelineSummary().wonValueByCurrency.some(
      (row) => row.currency === "THB" && row.cents === 425050
    ));

    const exported = getExportRows(
      "targets",
      new URLSearchParams()
    ) as Array<Record<string, unknown>>;
    assert.equal(exported[0]?.valueCents, 425050);
    assert.equal(exported[0]?.currency, "THB");
  });

  await t.test("reopening clears the close date and stage move records closure", async () => {
    await runAction(pipelineActions.moveTargetStageAction, {
      targetId: "t1",
      stage: "in_conversation"
    });
    assert.equal(
      (
        sqlite
          .prepare(
            "SELECT closed_at AS closedAt, lost_reason AS lostReason FROM targets WHERE id = 't1'"
          )
          .get() as { closedAt: string | null; lostReason: string | null }
      ).closedAt,
      null
    );

    await runAction(pipelineActions.moveTargetStageAction, {
      targetId: "t1",
      stage: "lost"
    });
    const closed = sqlite
      .prepare(
        "SELECT closed_at AS closedAt, stage FROM targets WHERE id = 't1'"
      )
      .get() as { closedAt: string | null; stage: string };
    assert.equal(closed.stage, "lost");
    assert.ok(closed.closedAt);
  });
});
