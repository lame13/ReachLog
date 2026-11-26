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

test("opportunity and relationship workflow", async (t) => {
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
  const contactActions = await import(
    "../src/modules/opportunities/contact-actions"
  );
  const opportunityContacts = await import(
    "../src/modules/opportunities/contacts"
  );
  const duplicateQueries = await import("../src/modules/duplicates/queries");
  const duplicateActions = await import("../src/modules/duplicates/actions");
  const stale = await import("../src/modules/opportunities/stale");
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
    assert.equal(values.parseDealValueToCents("12,34"), undefined);
    assert.equal(values.parseDealValueToCents("1e2"), 10000);
    const totals = [{ currency: "USD", cents: 0 }, { currency: "EUR", cents: 100 }, { currency: "THB", cents: 200 }];
    assert.equal(values.formatPipelineValue(totals), totals.map(({ cents, currency }) =>
      values.formatMoney(cents, currency, { compact: true })).join(" + "));
    assert.equal(values.formatPipelineValue([]), "No value set");
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
            "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '0012'"
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

  await t.test("an invalid deal value cannot clear a saved amount", async () => {
    await assert.rejects(
      outreachActions.updateTargetAction(form({ targetId: "t1", companyName: "Northstar", dealValue: "1000000001" })),
      /deal value/
    );
    assert.equal(sqlite.prepare("SELECT value_cents FROM targets WHERE id = 't1'").pluck().get(), 425050);
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

  await t.test("additional opportunity people keep clear roles", async () => {
    sqlite
      .prepare(
        `
        INSERT INTO contacts (
          id, account_id, name, email, domain, title, created_at, updated_at
        )
        VALUES (
          'c-finance', 'a1', 'Pim', 'pim@northstar.example',
          'northstar.example', 'Finance lead', ?, ?
        )
      `
      )
      .run(now, now);

    await runAction(contactActions.addOpportunityContactAction, {
      targetId: "t1",
      contactId: "c-finance",
      role: "Finance"
    });
    assert.deepEqual(
      opportunityContacts
        .getTargetAdditionalContacts("t1")
        .map((contact) => [contact.contactId, contact.role]),
      [["c-finance", "Finance"]]
    );
    assert.equal(
      opportunityContacts.getContactOpportunityRoles("c-finance")[0]?.targetId,
      "t1"
    );

    const assignment = sqlite
      .prepare(
        "SELECT id FROM target_contacts WHERE target_id = 't1' AND contact_id = 'c-finance'"
      )
      .get() as { id: string };
    await runAction(contactActions.removeOpportunityContactAction, {
      targetId: "t1",
      id: assignment.id
    });
    assert.equal(opportunityContacts.getTargetAdditionalContacts("t1").length, 0);
  });

  await t.test("duplicate suggestions require a review and merge safely", async () => {
    sqlite
      .prepare(
        `
        INSERT INTO accounts (
          id, name, domain, dedupe_key, notes, created_at, updated_at
        )
        VALUES (
          'a-duplicate', 'Northstar LLC', NULL, 'name:northstar llc',
          'Second account note', ?, ?
        )
      `
      )
      .run(now, now);
    sqlite
      .prepare(
        `
        INSERT INTO targets (
          id, account_id, company_name, source_type, dedupe_key, status,
          stage, created_at, updated_at
        )
        VALUES (
          't-duplicate', 'a-duplicate', 'Northstar LLC', 'manual',
          'duplicate-target', 'new', 'new', ?, ?
        )
      `
      )
      .run(now, now);
    sqlite
      .prepare(
        `
        INSERT INTO contacts (
          id, account_id, name, email, domain, created_at, updated_at
        )
        VALUES (
          'c-mina-duplicate', 'a1', 'Mina', 'mina.alt@northstar.example',
          'northstar.example', ?, ?
        )
      `
      )
      .run(now, now);

    const suggestions = duplicateQueries.getDuplicateSuggestions();
    assert.ok(
      suggestions.accounts.some(
        (row) => row.merge.id === "a-duplicate" && row.keep.id === "a1"
      )
    );
    assert.ok(
      suggestions.contacts.some(
        (row) =>
          row.merge.id === "c-mina-duplicate" && row.keep.id === "c1"
      )
    );

    await runAction(duplicateActions.mergeAccountsAction, {
      keepId: "a1",
      mergeId: "a-duplicate"
    });
    assert.equal(
      (
        sqlite
          .prepare("SELECT account_id AS accountId FROM targets WHERE id = 't-duplicate'")
          .get() as { accountId: string }
      ).accountId,
      "a1"
    );
    assert.equal(
      (
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM accounts WHERE id = 'a-duplicate'"
          )
          .get() as { count: number }
      ).count,
      0
    );

    sqlite.prepare("UPDATE contacts SET email_verification_status = 'pending', email_verification_checked_at = NULL WHERE id = 'c1'").run();
    sqlite.prepare("UPDATE contacts SET email_verification_status = 'valid', email_verification_checked_at = ? WHERE id = 'c-mina-duplicate'").run(now);
    await runAction(contactActions.addOpportunityContactAction, {
      targetId: "t1", contactId: "c-mina-duplicate", role: "Finance"
    });
    await runAction(contactActions.addOpportunityContactAction, {
      targetId: "t-duplicate", contactId: "c-mina-duplicate", role: "Champion"
    });
    await runAction(duplicateActions.mergeContactsAction, {
      keepId: "c1",
      mergeId: "c-mina-duplicate"
    });
    assert.equal(
      (
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM contacts WHERE id = 'c-mina-duplicate'"
          )
          .get() as { count: number }
      ).count,
      0
    );
    assert.deepEqual(sqlite.prepare("SELECT email_verification_status, email_verification_checked_at FROM contacts WHERE id = 'c1'").get(), {
      email_verification_status: "pending", email_verification_checked_at: null
    });
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM target_contacts WHERE target_id = 't1'").pluck().get(), 0);
    assert.deepEqual(sqlite.prepare("SELECT contact_id, role FROM target_contacts WHERE target_id = 't-duplicate'").get(), {
      contact_id: "c1", role: "Champion"
    });
    assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
  });

  await t.test("duplicate suggestions distinguish names written in non-Latin scripts", () => {
    const contact = sqlite.prepare("INSERT INTO contacts (id, account_id, name, email, domain, created_at, updated_at) VALUES (?, 'a1', ?, ?, 'northstar.example', ?, ?)");
    for (const [id, name] of [["li", "李明"], ["li2", "李明"], ["wang", "王敏"]]) {
      contact.run(id, name, `${id}@northstar.example`, now, now);
    }
    const pairs = duplicateQueries.getDuplicateSuggestions().contacts;
    assert.ok(pairs.some(({ keep, merge }) => keep.id === "li" && merge.id === "li2"));
    assert.ok(pairs.every(({ keep, merge }) => keep.id !== "wang" && merge.id !== "wang"));
  });

  await t.test("stale opportunities are batched once per activity period", () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    sqlite
      .prepare(
        `
        INSERT INTO targets (
          id, account_id, company_name, source_type, dedupe_key, status,
          stage, created_at, updated_at
        )
        VALUES (
          't-stale', 'a1', 'Quiet Co', 'manual', 'quiet-co', 'waiting',
          'contacted', ?, ?
        )
      `
      )
      .run(old, old);

    const found = stale.findStaleOpportunities({
      sqlite,
      days: 14,
      now: new Date()
    });
    assert.ok(found.some((row) => row.targetId === "t-stale"));

    sqlite
      .prepare("UPDATE targets SET stale_notified_at = ? WHERE id = 't-stale'")
      .run(found.find((row) => row.targetId === "t-stale")?.activityAt);
    assert.equal(
      stale
        .findStaleOpportunities({ sqlite, days: 14 })
        .some((row) => row.targetId === "t-stale"),
      false
    );
    assert.ok(queries.getDashboardData().staleOpportunities.some((row) => row.targetId === "t-stale"));
    sqlite.prepare("UPDATE targets SET next_step = 'Call Mina', stale_notified_at = NULL WHERE id = 't-stale'").run();
    assert.ok(!queries.getDashboardData().staleOpportunities.some((row) => row.targetId === "t-stale"));
    assert.ok(!stale.findStaleOpportunities({ sqlite, days: 14 }).some((row) => row.targetId === "t-stale"));
  });

  await t.test("closure is consistent for imports, legacy stages and stale follow-up forms", async () => {
    const { commitCsvImportAction } = await import("../src/modules/outreach/import-actions");
    const { initialImportState } = await import("../src/modules/outreach/import-state");
    const { markDeadAction } = await import("../src/modules/followups/actions");
    await commitCsvImportAction(initialImportState, form({
      csvText: "company_name,email,status,follow_up_date\nSold,owner@sold.example,won,2026-12-20"
    }));
    const imported = sqlite.prepare("SELECT id FROM targets WHERE company_name = 'Sold' AND stage = 'won'").pluck().get();
    assert.ok(imported);
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM followup_tasks WHERE target_id = ?").pluck().get(imported), 0);

    await runAction(outreachActions.createTargetAction, {
      companyName: "Signed deal", dedupeKey: "signed-deal", status: "signed"
    });
    const targetId = sqlite.prepare("SELECT id FROM targets WHERE dedupe_key = 'signed-deal'").pluck().get() as string;
    const closure = sqlite.prepare("SELECT stage, closed_at FROM targets WHERE id = ?");
    assert.ok((closure.get(targetId) as { closed_at: string }).closed_at);
    await runAction(markDeadAction, { targetId, followupId: "old-followup" });
    assert.equal((closure.get(targetId) as { stage: string }).stage, "won");
    await runAction(pipelineActions.moveTargetStageAction, { targetId, stage: "qualified" });
    await runAction(outreachActions.updateDoNotResendAction, { targetId, enabled: "true" });
    const closed = closure.get(targetId) as { stage: string; closed_at: string };
    assert.equal(closed.stage, "lost");
    assert.ok(closed.closed_at);
  });
});
