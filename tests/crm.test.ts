import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

/**
 * The server actions revalidate paths, which needs a request context. Outside
 * one Next throws before the browser is redirected; the database work has
 * already happened by then, which is what these tests assert on.
 */
async function runAction(action: (formData: FormData) => Promise<unknown>, values: Record<string, string>) {
  try {
    await action(form(values));
  } catch (error) {
    assert.match(String(error), /static generation store missing in revalidatePath|NEXT_REDIRECT/);
  }
}

test("0.4.0 accounts, contacts and pipeline", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "reachlog-crm-"));
  for (const key of Object.keys(process.env))
    if (/^(SMTP_|IMAP_|TELEGRAM_|EMAILLISTVERIFY_|REACHLOG_|DEMO_|SEED_)/.test(key))
      delete process.env[key];
  Object.assign(process.env, {
    DATABASE_PATH: path.join(directory, "app.sqlite"),
    BACKUP_DIR: path.join(directory, "backups"),
    REACHLOG_CONNECTIONS_PATH: path.join(directory, "connections.json"),
    DEMO_MODE: "false",
    SEED_DEMO_DATA: "false"
  });

  const { getSqlite } = await import("../src/modules/core/db/client");
  const { bootstrapDatabase } = await import("../src/modules/core/db/bootstrap");
  const stages = await import("../src/modules/pipeline/stages");
  const accounts = await import("../src/modules/accounts/queries");
  const accountActions = await import("../src/modules/accounts/actions");
  const contactQueries = await import("../src/modules/contacts/queries");
  const contactActions = await import("../src/modules/contacts/actions");
  const pipeline = await import("../src/modules/pipeline/queries");
  const pipelineActions = await import("../src/modules/pipeline/actions");
  const outreachActions = await import("../src/modules/outreach/actions");
  const importActions = await import("../src/modules/outreach/import-actions");
  const { initialImportState } = await import("../src/modules/outreach/import-state");
  const { getExportRows } = await import("../src/modules/export/data");
  const { getTimeline } = await import("../src/modules/timeline/events");
  const sqlite = getSqlite();

  const now = new Date().toISOString();

  t.after(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await t.test("stage vocabulary maps the old free-text statuses", () => {
    assert.deepEqual(
      stages.stageFromLegacyStatus("replied"),
      "replied"
    );
    assert.equal(stages.stageFromLegacyStatus("follow-up due"), "contacted");
    assert.equal(stages.stageFromLegacyStatus("form submitted"), "contacted");
    assert.equal(stages.stageFromLegacyStatus("sent"), "contacted");
    assert.equal(stages.stageFromLegacyStatus("waiting"), "contacted");
    assert.equal(stages.stageFromLegacyStatus("dead"), "lost");
    assert.equal(stages.stageFromLegacyStatus("do not send"), "lost");
    assert.equal(stages.stageFromLegacyStatus("bounced"), "lost");
    assert.equal(stages.stageFromLegacyStatus("proposal sent"), "qualified");
    assert.equal(stages.stageFromLegacyStatus("won"), "won");
    assert.equal(stages.stageFromLegacyStatus("client"), "won");
    assert.equal(stages.stageFromLegacyStatus(""), "new");
    assert.equal(stages.stageFromLegacyStatus(null), "new");
    assert.equal(stages.getPipelineStage("nonsense").key, "new");
    assert.ok(stages.isPipelineStage("in_conversation"));
    assert.equal(stages.isPipelineStage("in conversation"), false);

    // A hand-set blocking status survives a stage move, so the board cannot
    // quietly re-enable sending.
    assert.equal(stages.statusForStageMove("dead", "contacted"), "dead");
    assert.equal(stages.statusForStageMove("replied", "won"), "replied");
    assert.equal(stages.statusForStageMove("waiting", "lost"), "dead");
  });

  await t.test("an upgrade from 0007 derives accounts and stages without losing records", () => {
    const legacyPath = path.join(directory, "legacy.sqlite");
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        domain TEXT NOT NULL,
        email_verification_provider TEXT,
        email_verification_status TEXT,
        email_verification_checked_at TEXT,
        email_verification_error TEXT,
        email_verification_raw TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX contacts_email_unique ON contacts(email);
      CREATE INDEX contacts_domain_idx ON contacts(domain);
      CREATE TABLE targets (
        id TEXT PRIMARY KEY,
        contact_id TEXT REFERENCES contacts(id),
        company_name TEXT NOT NULL,
        website_url TEXT,
        source_type TEXT NOT NULL,
        source_url TEXT,
        dedupe_key TEXT NOT NULL,
        status TEXT NOT NULL,
        do_not_resend INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX targets_dedupe_key_unique ON targets(dedupe_key);
      CREATE INDEX targets_contact_idx ON targets(contact_id);
      CREATE INDEX targets_status_idx ON targets(status);
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES ('0007', 'connections_scheduling_templates', '2026-09-27T00:00:00.000Z');
    `);
    const insertContact = legacy.prepare(
      "INSERT INTO contacts (id, name, email, domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    insertContact.run("c-alex", "Alex", "alex@acme.example", "acme.example", now, now);
    insertContact.run("c-bo", "Bo", "bo@boost.example", "boost.example", now, now);
    const insertTarget = legacy.prepare(
      `INSERT INTO targets (id, contact_id, company_name, website_url, source_type, source_url, dedupe_key, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertTarget.run("t-acme", "c-alex", "Acme Hosting", "https://acme.example", "hn", null, "email:alex@acme.example", "replied", now, now);
    insertTarget.run("t-acme-2", "c-alex", "Acme Hosting", "https://acme.example", "hn", null, "domain:acme.example", "follow-up due", now, now);
    insertTarget.run("t-boost", "c-bo", "Boost Co", "https://boost.example", "wporg", null, "email:bo@boost.example", "dead", now, now);
    insertTarget.run("t-form", null, "Form Only Co", null, "contact_form", "https://form.example/contact", "form:form.example/contact", "new", now, now);
    legacy.close();

    try {
      const upgraded = new Database(legacyPath);
      bootstrapDatabase(upgraded);

      assert.equal((upgraded.prepare("SELECT COUNT(*) AS n FROM targets").get() as { n: number }).n, 4);
      assert.equal((upgraded.prepare("SELECT COUNT(*) AS n FROM contacts").get() as { n: number }).n, 2);
      assert.equal((upgraded.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n, 3);
      assert.equal(
        (upgraded.prepare("SELECT COUNT(*) AS n FROM targets WHERE account_id IS NULL").get() as { n: number }).n,
        0
      );
      assert.equal(
        (upgraded.prepare("SELECT COUNT(*) AS n FROM contacts WHERE account_id IS NULL").get() as { n: number }).n,
        0
      );

      // Two targets for the same company and domain share one account.
      assert.deepEqual(
        upgraded
          .prepare(
            "SELECT account_id as accountId FROM targets WHERE id IN ('t-acme','t-acme-2')"
          )
          .all()
          .map((row) => (row as { accountId: string }).accountId)
          .filter((id, index, all) => all.indexOf(id) === index).length,
        1
      );

      assert.equal(
        (upgraded.prepare("SELECT stage FROM targets WHERE id = 't-acme'").get() as { stage: string }).stage,
        "replied"
      );
      assert.equal(
        (upgraded.prepare("SELECT stage FROM targets WHERE id = 't-acme-2'").get() as { stage: string }).stage,
        "contacted"
      );
      assert.equal(
        (upgraded.prepare("SELECT stage FROM targets WHERE id = 't-boost'").get() as { stage: string }).stage,
        "lost"
      );
      assert.equal(
        (upgraded.prepare("SELECT stage FROM targets WHERE id = 't-form'").get() as { stage: string }).stage,
        "new"
      );
      assert.equal(
        (upgraded.prepare("SELECT name FROM accounts WHERE lower(domain) = 'acme.example'").get() as { name: string }).name,
        "Acme Hosting"
      );

      // A stage set by hand is never overwritten by a later startup.
      upgraded.prepare("UPDATE targets SET stage = 'qualified' WHERE id = 't-acme'").run();
      bootstrapDatabase(upgraded);
      assert.equal(
        (upgraded.prepare("SELECT stage FROM targets WHERE id = 't-acme'").get() as { stage: string }).stage,
        "qualified"
      );
      assert.equal((upgraded.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n, 3);
      assert.deepEqual(upgraded.pragma("foreign_key_check"), []);
      upgraded.close();
    } finally {
      rmSync(legacyPath, { force: true });
    }
  });

  // Fixtures for the request-shaped tests below.
  sqlite
    .prepare(
      "INSERT INTO accounts (id, name, domain, website_url, dedupe_key, created_at, updated_at) VALUES ('a-acme','Acme Hosting','acme.example','https://acme.example','domain:acme.example',?,?)"
    )
    .run(now, now);
  sqlite
    .prepare(
      "INSERT INTO contacts (id, account_id, name, email, domain, title, created_at, updated_at) VALUES ('c-alex','a-acme','Alex','alex@acme.example','acme.example','Ops lead',?,?)"
    )
    .run(now, now);
  sqlite
    .prepare(
      `INSERT INTO targets (id, contact_id, account_id, company_name, website_url, source_type, dedupe_key, status, stage, created_at, updated_at)
       VALUES ('t-acme','c-alex','a-acme','Acme Hosting','https://acme.example','hn','email:alex@acme.example','replied','replied',?,?)`
    )
    .run(now, now);

  await t.test("creating a target finds or creates its account and keeps contacts linked", async () => {
    await runAction(outreachActions.createTargetAction, {
      companyName: "Nimbus Cloud",
      contactName: "Jo",
      email: "jo@nimbus.example",
      websiteUrl: "https://nimbus.example",
      sourceType: "hn",
      status: "sent",
      stage: "contacted"
    });

    const account = sqlite
      .prepare("SELECT id, dedupe_key as dedupeKey FROM accounts WHERE lower(domain) = 'nimbus.example'")
      .get() as { id: string; dedupeKey: string } | undefined;
    assert.ok(account, "an account is created for the new company");
    assert.equal(account.dedupeKey, "domain:nimbus.example");

    const target = sqlite
      .prepare("SELECT account_id as accountId, stage FROM targets WHERE dedupe_key = 'email:jo@nimbus.example'")
      .get() as { accountId: string; stage: string };
    assert.equal(target.accountId, account.id);
    assert.equal(target.stage, "contacted");

    const contact = sqlite
      .prepare("SELECT account_id as accountId, title FROM contacts WHERE email = 'jo@nimbus.example'")
      .get() as { accountId: string; title: string | null };
    assert.equal(contact.accountId, account.id);
    assert.equal(contact.title, null);
  });

  await t.test("the CSV import links rows to accounts and maps their stage", async () => {
    // Import revalidates paths, which throws outside a request and is reported
    // as an error state; the rows are written before that, so the database is
    // what this asserts on.
    await importActions.commitCsvImportAction(
      initialImportState,
      form({
        csvText:
          "company_name,email,domain_key,status,dedupe_key\nVerve Studio,vv@verve.example,verve.example,replied,email:vv@verve.example"
      })
    );

    const target = sqlite
      .prepare("SELECT account_id as accountId, stage FROM targets WHERE dedupe_key = 'email:vv@verve.example'")
      .get() as { accountId: string; stage: string } | undefined;
    assert.ok(target, "the imported target exists");
    assert.equal(target.stage, "replied");
    assert.ok(target.accountId);
    assert.equal(
      (sqlite.prepare("SELECT name FROM accounts WHERE id = ?").get(target.accountId) as { name: string }).name,
      "Verve Studio"
    );
    assert.equal(
      (sqlite.prepare("SELECT account_id as accountId FROM contacts WHERE email = 'vv@verve.example'").get() as { accountId: string }).accountId,
      target.accountId
    );
  });

  await t.test("moving a card writes the stage, the status and one timeline entry", async () => {
    await runAction(pipelineActions.moveTargetStageAction, {
      targetId: "t-acme",
      stage: "won"
    });

    const moved = sqlite
      .prepare("SELECT stage, status FROM targets WHERE id = 't-acme'")
      .get() as { stage: string; status: string };
    assert.equal(moved.stage, "won");
    assert.equal(moved.status, "replied");

    const events = getTimeline({ targetIds: ["t-acme"] });
    assert.equal(events[0]?.eventType, "stage_changed");
    assert.match(events[0]?.detail ?? "", /stage: won/);
    assert.match(events[0]?.detail ?? "", /from stage: replied/);

    // Moving to the same stage again is a no-op rather than a second event.
    const before = sqlite
      .prepare("SELECT COUNT(*) AS n FROM events WHERE event_type = 'stage_changed' AND entity_id = 't-acme'")
      .get() as { n: number };
    await runAction(pipelineActions.moveTargetStageAction, {
      targetId: "t-acme",
      stage: "won"
    });
    assert.equal(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type = 'stage_changed' AND entity_id = 't-acme'").get() as { n: number }).n,
      before.n
    );
  });

  await t.test("closing a target as lost cancels its open follow-ups", async () => {
    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    sqlite
      .prepare(
        "INSERT INTO followup_tasks (id, thread_id, target_id, due_at, status, created_at) VALUES ('f-acme', NULL, 't-acme', ?, 'open', ?)"
      )
      .run(dueAt, now);

    await runAction(pipelineActions.moveTargetStageAction, {
      targetId: "t-acme",
      stage: "lost"
    });

    assert.equal(
      (sqlite.prepare("SELECT status FROM followup_tasks WHERE id = 'f-acme'").get() as { status: string }).status,
      "cancelled"
    );
    assert.equal(
      (sqlite.prepare("SELECT status FROM targets WHERE id = 't-acme'").get() as { status: string }).status,
      "dead"
    );
  });

  await t.test("the board groups by stage and the summary counts everything", () => {
    const board = pipeline.getPipelineBoard();
    assert.equal(board.length, stages.pipelineStages.length);
    assert.deepEqual(
      board.map((column) => column.key),
      stages.pipelineStages.map((stage) => stage.key)
    );
    const lost = board.find((column) => column.key === "lost");
    assert.equal(lost?.count, 1);
    assert.equal(lost?.cards[0]?.id, "t-acme");
    assert.equal(board.find((column) => column.key === "won")?.count, 0);

    assert.deepEqual(
      pipeline.getPipelineBoard({ q: "nimbus" }).map((column) => column.count),
      [0, 1, 0, 0, 0, 0, 0]
    );

    const summary = pipeline.getPipelineSummary();
    assert.equal(summary.total, 3);
    assert.equal(summary.lost, 1);
    assert.equal(summary.open, 2);
    assert.equal(summary.accounts, 3);
    assert.equal(summary.byStage.new, 0);
    assert.equal(summary.byStage.contacted, 1);
    assert.equal(summary.byStage.replied, 1);
  });

  await t.test("account queries aggregate targets and contacts and share one timeline", () => {
    const list = accounts.getAccounts();
    const acme = list.find((account) => account.id === "a-acme");
    assert.ok(acme);
    assert.equal(acme.contactCount, 1);
    assert.equal(acme.targetCount, 1);
    assert.equal(acme.wonTargetCount, 0);

    assert.deepEqual(
      accounts.getAccounts({ q: "acme" }).map((account) => account.id),
      ["a-acme"]
    );
    assert.deepEqual(accounts.getAccounts({ q: "nothing-here" }), []);

    const detail = accounts.getAccountDetail("a-acme");
    assert.ok(detail);
    assert.equal(detail.contacts[0]?.email, "alex@acme.example");
    assert.equal(detail.targets[0]?.id, "t-acme");
    assert.ok(detail.timeline.some((item) => item.eventType === "stage_changed"));
    assert.equal(accounts.getAccountDetail("missing"), null);
    assert.deepEqual(
      accounts.getAccountOptions().map((option) => option.id).includes("a-acme"),
      true
    );
  });

  await t.test("accounts can be created, edited and annotated by hand", async () => {
    await runAction(accountActions.createAccountAction, {
      name: "Cobalt Works",
      domain: "cobalt.example",
      websiteUrl: "https://cobalt.example",
      notes: "Introduced by Alex."
    });

    const created = sqlite
      .prepare("SELECT id, dedupe_key as dedupeKey, notes FROM accounts WHERE lower(domain) = 'cobalt.example'")
      .get() as { id: string; dedupeKey: string; notes: string };
    assert.equal(created.dedupeKey, "domain:cobalt.example");
    assert.equal(created.notes, "Introduced by Alex.");

    await runAction(accountActions.updateAccountAction, {
      accountId: created.id,
      name: "Cobalt Works Ltd",
      domain: "cobalt.example",
      websiteUrl: "https://cobalt.example",
      notes: "Signed a retainer."
    });
    assert.equal(
      (sqlite.prepare("SELECT name, notes FROM accounts WHERE id = ?").get(created.id) as { name: string; notes: string }).name,
      "Cobalt Works Ltd"
    );

    await runAction(accountActions.addAccountNoteAction, {
      accountId: created.id,
      note: "Prefers Thursday calls."
    });
    const timeline = getTimeline({ accountId: created.id });
    assert.deepEqual(
      timeline.map((item) => item.eventType),
      ["account_note_added", "account_updated", "account_created"]
    );

    // A duplicate account name/domain is refused instead of merged silently.
    await runAction(accountActions.createAccountAction, {
      name: "Acme Hosting",
      domain: "acme.example"
    });
    assert.equal(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM accounts WHERE lower(domain) = 'acme.example'").get() as { n: number }).n,
      1
    );
  });

  await t.test("contacts are created, linked and edited from their own pages", async () => {
    await runAction(contactActions.createContactAction, {
      name: "Dana",
      email: "dana@cobalt.example",
      title: "Head of Ops",
      phone: "+66 2 000 0000",
      tags: "warm, referral",
      accountId: sqlite
        .prepare("SELECT id FROM accounts WHERE lower(domain) = 'cobalt.example'")
        .pluck()
        .get() as string,
      links: "https://linkedin.example/dana\nhttps://cobalt.example/team"
    });

    const contact = sqlite
      .prepare("SELECT id, account_id as accountId, title, phone, tags, links_json as linksJson FROM contacts WHERE email = 'dana@cobalt.example'")
      .get() as { id: string; accountId: string; title: string; phone: string; tags: string; linksJson: string };
    assert.equal(contact.title, "Head of Ops");
    assert.equal(contact.tags, "warm, referral");
    assert.deepEqual(contactQueries.parseStoredLinks(contact.linksJson), [
      "https://linkedin.example/dana",
      "https://cobalt.example/team"
    ]);
    assert.deepEqual(contactQueries.parseStoredLinks("not json"), []);
    assert.ok(contact.accountId);

    await runAction(contactActions.updateContactAction, {
      contactId: contact.id,
      name: "Dana Ops",
      email: "dana@cobalt.example",
      domain: "cobalt.example",
      title: "COO",
      tags: "client",
      accountId: contact.accountId,
      links: "https://cobalt.example/team"
    });
    assert.equal(
      (sqlite.prepare("SELECT title FROM contacts WHERE id = ?").get(contact.id) as { title: string }).title,
      "COO"
    );

    await runAction(contactActions.addContactNoteAction, {
      contactId: contact.id,
      note: "Call booked."
    });
    assert.equal(
      getTimeline({ contactId: contact.id })[0]?.eventType,
      "contact_note_added"
    );

    const detail = contactQueries.getContactDetail(contact.id);
    assert.ok(detail);
    assert.equal(detail.contact.name, "Dana Ops");
    assert.equal(contactQueries.getContactDetail("missing"), null);

    // Filtering by tag and by account both work off the stored comma list.
    assert.deepEqual(
      contactQueries.getContacts({ tag: "CLIENT" }).map((row) => row.id),
      [contact.id]
    );
    assert.deepEqual(
      contactQueries.getContacts({ accountId: contact.accountId }).map((row) => row.id),
      [contact.id]
    );
    assert.deepEqual(contactQueries.getContacts({ q: "dana ops" }).map((row) => row.id), [contact.id]);
    assert.deepEqual(contactQueries.getContacts({ q: "no-such-contact" }), []);
    assert.equal(contactQueries.getContactFilterOptions().tags.includes("client"), true);
  });

  await t.test("a second contact cannot take an email that is already in use", async () => {
    await runAction(contactActions.updateContactAction, {
      contactId: "c-alex",
      name: "Alex",
      email: "dana@cobalt.example",
      domain: "cobalt.example"
    });
    assert.equal(
      (sqlite.prepare("SELECT email FROM contacts WHERE id = 'c-alex'").get() as { email: string }).email,
      "alex@acme.example"
    );
    assert.ok(
      getTimeline({ contactId: "c-alex" }).some(
        (item) => item.eventType === "contact_update_blocked"
      )
    );
  });

  await t.test("exports carry the new account and stage fields", () => {
    const targetRows = getExportRows("targets", new URLSearchParams()) as Array<
      Record<string, unknown>
    >;
    const acme = targetRows.find((row) => row.id === "t-acme");
    assert.equal(acme?.stage, "lost");
    assert.equal(acme?.accountName, "Acme Hosting");
    assert.equal(acme?.accountId, "a-acme");

    const accountRows = getExportRows("accounts", new URLSearchParams()) as Array<
      Record<string, unknown>
    >;
    assert.ok(accountRows.some((row) => row.name === "Cobalt Works Ltd"));

    const contactRows = getExportRows("contacts", new URLSearchParams()) as Array<
      Record<string, unknown>
    >;
    const dana = contactRows.find((row) => row.email === "dana@cobalt.example");
    assert.equal(dana?.title, "COO");
    assert.equal(dana?.accountName, "Cobalt Works Ltd");
    assert.equal(dana?.tags, "client");

    // Export filters keep working with the stage parameter.
    const lostTargets = getExportRows(
      "targets",
      new URLSearchParams({ stage: "lost" })
    ) as Array<Record<string, unknown>>;
    assert.deepEqual(lostTargets.map((row) => row.id), ["t-acme"]);
  });

  await t.test("the schema reports migration 0009", () => {
    assert.equal(
      (sqlite
        .prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
        .get() as { version: string }).version,
      "0009"
    );
  });

  await t.test("saving target details preserves status until the stage changes, and Lost cancels reminders", async () => {
    sqlite.prepare("INSERT INTO targets (id, company_name, source_type, dedupe_key, status, stage, created_at, updated_at) VALUES ('edit-stage', 'Edit stage', 'manual', 'edit-stage', 'sent', 'contacted', ?, ?)").run(now, now);
    const values = { targetId: "edit-stage", companyName: "Edit stage", sourceType: "manual", dedupeKey: "edit-stage", status: "sent", stage: "contacted" };
    await runAction(outreachActions.updateTargetAction, values);
    assert.equal(sqlite.prepare("SELECT status FROM targets WHERE id = 'edit-stage'").pluck().get(), "sent");

    sqlite.prepare("INSERT INTO followup_tasks (id, target_id, due_at, status, created_at) VALUES ('edit-reminder', 'edit-stage', ?, 'open', ?)").run(now, now);
    await runAction(outreachActions.updateTargetAction, { ...values, stage: "lost", nextFollowupDate: "2030-01-01" });
    assert.equal(sqlite.prepare("SELECT status FROM targets WHERE id = 'edit-stage'").pluck().get(), "dead");
    assert.equal(sqlite.prepare("SELECT COUNT(*) FROM followup_tasks WHERE target_id = 'edit-stage' AND status = 'open'").pluck().get(), 0);
    const event = getTimeline({ targetIds: ["edit-stage"] }).find((item) => item.eventType === "target_updated");
    assert.match(event?.detail ?? "", /status: dead/);
  });

  await t.test("a stage move cannot bypass a do-not-resend block", async () => {
    sqlite.prepare("INSERT INTO targets (id, company_name, source_type, dedupe_key, status, stage, do_not_resend, created_at, updated_at) VALUES ('blocked-stage', 'Blocked', 'manual', 'blocked-stage', 'waiting', 'contacted', 1, ?, ?)").run(now, now);
    await runAction(pipelineActions.moveTargetStageAction, { targetId: "blocked-stage", stage: "replied" });
    const row = sqlite.prepare("SELECT status, do_not_resend AS doNotResend FROM targets WHERE id = 'blocked-stage'").get() as { status: string; doNotResend: number };
    const { isTargetActionBlocked } = await import("../src/modules/outreach/status");
    assert.equal(isTargetActionBlocked(row), true);
  });

  await t.test("company websites take precedence over contact email domains and enrich name-only accounts", async () => {
    await runAction(accountActions.createAccountAction, { name: "Website Company" });
    const firstId = sqlite.prepare("SELECT id FROM accounts WHERE name = 'Website Company'").pluck().get();
    await runAction(outreachActions.createTargetAction, { companyName: "Website Company", websiteUrl: "https://website-company.example", email: "website-owner@shared-mail.example", sourceType: "manual" });
    const linked = sqlite.prepare("SELECT accounts.id, accounts.domain FROM targets JOIN accounts ON accounts.id = targets.account_id WHERE targets.company_name = 'Website Company'").get();
    assert.deepEqual(linked, { id: firstId, domain: "website-company.example" });
    await runAction(outreachActions.createTargetAction, { companyName: "Another Company", websiteUrl: "https://another-company.example", email: "another-owner@shared-mail.example", sourceType: "manual" });
    assert.notEqual(sqlite.prepare("SELECT account_id FROM targets WHERE company_name = 'Another Company'").pluck().get(), firstId);
  });

  await t.test("CRM exports respect contact, account and tag filters", () => {
    const danaId = sqlite.prepare("SELECT id FROM contacts WHERE email = 'dana@cobalt.example'").pluck().get() as string;
    const ids = (entity: "contacts" | "targets" | "accounts", filters: Record<string, string>) =>
      (getExportRows(entity, new URLSearchParams(filters)) as Array<{ id: string }>).map((row) => row.id);
    assert.deepEqual(ids("contacts", { contactId: danaId }), [danaId]);
    assert.deepEqual(ids("contacts", { tag: "CLIENT", q: "dana" }), [danaId]);
    assert.deepEqual(ids("contacts", { accountId: "a-acme" }), ["c-alex"]);
    assert.deepEqual(ids("targets", { accountId: "a-acme" }), ["t-acme"]);
    assert.deepEqual(ids("accounts", { accountId: "a-acme" }), ["a-acme"]);
    assert.deepEqual(ids("contacts", { tag: "missing-tag" }), []);
  });

  await t.test("timeline ignores non-object payloads rather than breaking the page", async () => {
    const { describeEventPayload } = await import("../src/modules/timeline/events");
    for (const payload of ["null", "[]", "42", "broken json"]) assert.equal(describeEventPayload(payload), null);
    assert.equal(describeEventPayload('{"note":"Call tomorrow"}'), "Call tomorrow");
  });

  await t.test("latest account and contact activity includes newer outbound mail and notes", async () => {
    const past = "2026-01-01T00:00:00.000Z";
    const latest = "2030-01-01T00:00:00.000Z";
    sqlite.prepare("INSERT INTO threads (id, target_id, contact_id, mailbox, subject, normalized_subject, status, last_inbound_at, last_outbound_at, created_at, updated_at) VALUES ('activity-thread', 't-acme', 'c-alex', 'test', 'History', 'history', 'waiting', ?, ?, ?, ?)").run(past, latest, past, latest);
    assert.equal(accounts.getAccountDetail("a-acme")?.account.lastActivityAt, latest);
    assert.equal(contactQueries.getContactDetail("c-alex")?.contact.lastActivityAt, latest);
    const noteAt = "2031-01-01T00:00:00.000Z";
    sqlite.prepare("INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at) VALUES ('new-account-note', 'account', 'a-acme', 'account_note_added', '{}', ?)").run(noteAt);
    assert.equal(accounts.getAccountDetail("a-acme")?.account.lastActivityAt, noteAt);
  });
});
