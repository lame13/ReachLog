import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { buildSync } from 'esbuild';
import { spawnSync } from 'node:child_process';

test('release regressions', async (t) => {
const directory = mkdtempSync(path.join(tmpdir(), 'reachlog-test-'));
process.env.DATABASE_PATH = path.join(directory, 'app.sqlite');
process.env.DEMO_MODE = 'false';
process.env.SEED_DEMO_DATA = 'false';
process.env.SMTP_ENABLED = 'false';
process.env.IMAP_ENABLED = 'false';
process.env.TELEGRAM_ENABLED = 'false';
process.env.EMAILLISTVERIFY_ENABLED = 'false';
// Imports happen after selecting an isolated database and disabling connections.
const client = await import('../src/modules/core/db/client');
const drafts = await import('../src/modules/smtp/drafts');
const { backupDatabase } = await import('../src/modules/core/db/backup');
const { bootstrapDatabase } = await import('../src/modules/core/db/bootstrap');
const { previewCsvImportAction } = await import('../src/modules/outreach/import-actions');
const { initialImportState } = await import('../src/modules/outreach/import-state');
const sqlite = client.getSqlite();

t.after(() => { sqlite.close(); rmSync(directory, { recursive: true, force: true }); });

await t.test('fresh startup is empty and migrations preserve existing records', () => {
  assert.equal((sqlite.prepare('SELECT count(*) AS n FROM contacts').get() as { n: number }).n, 0);
  sqlite.prepare(`INSERT INTO targets (id,company_name,source_type,dedupe_key,status,created_at,updated_at) VALUES ('fixture','Example','manual','domain:example.test','new',?,?)`).run(new Date().toISOString(), new Date().toISOString());
  bootstrapDatabase(sqlite);
  assert.equal((sqlite.prepare('SELECT count(*) AS n FROM targets').get() as { n: number }).n, 1);
});

await t.test('drafts retain complete text after reopening SQLite and update without duplicates', () => {
  const draft = { subject: 'Question', body: 'Line one\nLine two — with Unicode.', fromEmail: 'sender@example.test' };
  drafts.saveEmailDraft('fixture', draft);
  const reopened = new Database(process.env.DATABASE_PATH!);
  assert.equal((reopened.prepare('SELECT body FROM email_drafts').get() as { body: string }).body, draft.body);
  reopened.close();
  drafts.saveEmailDraft('fixture', { ...draft, body: 'Revised draft' });
  assert.equal(drafts.getEmailDraft('fixture')?.body, 'Revised draft');
  assert.equal((sqlite.prepare('SELECT count(*) AS n FROM email_drafts').get() as { n: number }).n, 1);
  drafts.clearEmailDraft('fixture');
  assert.equal(drafts.getEmailDraft('fixture'), null);
});

await t.test('two backups retain a valid database, even with spaces and quotes in their path', async () => {
  const backupDir = path.join(directory, "owner's backups");
  const first = await backupDatabase(sqlite, backupDir);
  const second = await backupDatabase(sqlite, backupDir);
  assert.notEqual(first, second);
  const restoredPath = path.join(directory, 'restored.sqlite');
  writeFileSync(restoredPath, gunzipSync(readFileSync(second)));
  const restored = new Database(restoredPath);
  assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal((restored.prepare('SELECT company_name AS name FROM targets').get() as { name: string }).name, 'Example');
  restored.close();
});

await t.test('CSV preview recognizes duplicates and does not write contacts', async () => {
  const form = new FormData();
  form.set('csvText', 'target,contact_type,contact_value,domain_key,dedupe_key\nExample,email,hello@example.test,example.test,domain:example.test');
  const result = await previewCsvImportAction(initialImportState, form);
  assert.equal(result.error, null);
  assert.equal(result.rows[0]?.result, 'duplicate target');
  assert.equal((sqlite.prepare('SELECT count(*) AS n FROM contacts').get() as { n: number }).n, 0);
});

await t.test('CLI rejects unsafe network exposure and invalid input before creating data', () => {
  const cli = path.join(directory, 'cli.cjs');
  buildSync({ entryPoints: ['src/cli.ts'], outfile: cli, bundle: true, platform: 'node', format: 'cjs', external: ['next/dist/bin/next'] });
  const env: NodeJS.ProcessEnv = { ...process.env, APP_URL: '', APP_BASIC_AUTH_ENABLED: 'false' };
  delete env.APP_URL;
  const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
  assert.match(run(['--help']).stdout, /mail-sync/);
  assert.match(run(['--port', 'NaN']).stderr, /Port must/);
  assert.match(run(['--host', '0.0.0.0']).stderr, /Network access requires/);
  assert.match(run(['demo', '--host', '0.0.0.0']).stderr, /Network access requires/);
  assert.match(run(['worker', 'unknown']).stderr, /Invalid arguments/);
  assert.match(run(['--env-file', path.join(directory, 'missing.env')]).stderr, /not found/);
});

});
