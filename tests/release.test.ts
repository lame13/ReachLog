import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { buildSync } from 'esbuild';
import { spawnSync } from 'node:child_process';

test('release regressions', async (t) => {
const directory = mkdtempSync(path.join(tmpdir(), 'reachlog-test-'));
process.env.DATABASE_PATH = path.join(directory, 'app.sqlite');
process.env.REACHLOG_CONNECTIONS_PATH = path.join(directory, 'connections.json');
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
const { verifyBackupFile } = await import('../src/modules/core/db/verify-backup');
const { bootstrapDatabase } = await import('../src/modules/core/db/bootstrap');
const { previewCsvImportAction } = await import('../src/modules/outreach/import-actions');
const { initialImportState } = await import('../src/modules/outreach/import-state');
const { getExportRows } = await import('../src/modules/export/data');
const { getTargets, getDueFollowupCount } = await import('../src/modules/outreach/queries');
const recoverSend = await import('../src/modules/smtp/recover-send');
const { completeAcceptedSendAction, sendNowAction } = await import('../src/modules/smtp/actions');
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

await t.test('search covers message text and detects wildcard characters literally', () => {
  const now = new Date().toISOString();
  sqlite.prepare("INSERT INTO contacts (id,name,email,domain,email_verification_status,created_at,updated_at) VALUES ('c1','Ada','ada@example.test','example.test','ok',?,?)").run(now, now);
  sqlite.prepare("INSERT INTO targets (id,contact_id,company_name,source_type,dedupe_key,status,created_at,updated_at) VALUES ('t1','c1','Ada Studio','manual','email:ada@example.test','waiting',?,?)").run(now, now);
  sqlite.prepare("INSERT INTO threads (id,target_id,contact_id,mailbox,subject,normalized_subject,status,created_at,updated_at) VALUES ('th1','t1','c1','main','Proposal','proposal','waiting',?,?)").run(now, now);
  sqlite.prepare("INSERT INTO messages (id,thread_id,direction,from_email,to_email,subject,body_text,message_id,created_at) VALUES ('m1','th1','inbound','ada@example.test','owner@example.test','Re: Proposal','The budget is approved.','<m1@example.test>',?)").run(now);

  assert.deepEqual(getTargets({ q: 'ada studio' }).map((target) => target.id), ['t1']);
  assert.deepEqual(getTargets({ q: 'budget is approved' }).map((target) => target.id), ['t1']);
  assert.deepEqual(getTargets({ q: 'Re: Proposal' }).map((target) => target.id), ['t1']);
  assert.deepEqual(getTargets({ q: '%' }), []);
  assert.deepEqual(getTargets({ q: '_' }), []);
  sqlite.prepare("UPDATE messages SET body_text = ? WHERE id = 'm1'").run('The budget is approved. 100% for project_alpha, stored at C:\\drafts.');
  for (const q of ['100%', 'project_alpha', 'C:\\drafts', 'owner@example.test']) {
    assert.deepEqual(getTargets({ q }).map((target) => target.id), ['t1']);
  }

  const contacts = getExportRows('contacts', new URLSearchParams()) as Array<Record<string, unknown>>;
  const exported = contacts.find((row) => row.email === 'ada@example.test');
  assert.equal(exported?.emailVerificationStatus, 'ok');
  assert.equal(exported?.targetCount, 1);
});

await t.test('an accepted send that was never saved can be recorded without sending again', async () => {
  const now = new Date().toISOString();
  const runRecovery = async (outboundSendId: string, targetId: string) => {
    const form = new FormData();
    form.set('outboundSendId', outboundSendId);
    form.set('targetId', targetId);
    try {
      await completeAcceptedSendAction(form);
    } catch (error) {
      assert.match(String(error), /static generation store missing in revalidatePath|NEXT_REDIRECT/);
    }
  };

  sqlite.prepare("INSERT INTO targets (id,company_name,source_type,dedupe_key,status,created_at,updated_at) VALUES ('t2','Reach Log Co','manual','email:owner@example.test','waiting',?,?)").run(now, now);
  sqlite.prepare("INSERT INTO outbound_sends (id,target_id,to_email,subject,body_text,message_id,send_key,status,attempts,sent_at,created_at,updated_at) VALUES ('s1','t2','hello@example.test','Quick question','Body text','<s1@example.test>','key-1','smtp_accepted_persist_failed',1,?,?,?)").run(now, now, now);
  sqlite.prepare("INSERT INTO events (id,entity_type,entity_id,event_type,payload_json,created_at) VALUES ('e-queued','target','t2','send_queued',?,?)").run(JSON.stringify({ outboundSendId: 's1', from: 'Owner <owner@example.test>', messageId: '<s1@example.test>' }), now);

  assert.equal(recoverSend.hasUnsavedAcceptedSend('t2'), true);
  assert.equal(recoverSend.getUnsavedAcceptedSend('s1', 't2')?.subject, 'Quick question');

  await runRecovery('s1', 't2');

  const send = sqlite.prepare("SELECT status, last_error, sent_at, attempts FROM outbound_sends WHERE id = 's1'").get() as { status: string; last_error: string | null; sent_at: string; attempts: number };
  assert.equal(send.status, 'sent');
  assert.equal(send.last_error, null);
  assert.equal(send.sent_at, now);
  assert.equal(send.attempts, 1, 'record recovery is not another SMTP attempt');
  const message = sqlite.prepare("SELECT direction, from_email, to_email FROM messages WHERE message_id = '<s1@example.test>'").get() as { direction: string; from_email: string; to_email: string };
  assert.equal(message.direction, 'outbound');
  assert.equal(message.from_email, 'Owner <owner@example.test>', 'the sender is recovered from the send audit trail');
  assert.equal(message.to_email, 'hello@example.test');
  assert.equal((sqlite.prepare("SELECT status FROM targets WHERE id = 't2'").get() as { status: string }).status, 'sent');
  assert.equal(recoverSend.hasUnsavedAcceptedSend('t2'), false);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM followup_tasks WHERE target_id = 't2'").get() as { n: number }).n, 0, 'recovery does not schedule a follow-up');
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM events WHERE event_type = 'send_record_recovered' AND entity_id = 't2'").get() as { n: number }).n, 1);

  await runRecovery('s1', 't2');

  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM messages WHERE message_id = '<s1@example.test>'").get() as { n: number }).n, 1, 'a second recovery does not duplicate the message');
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM outbound_sends WHERE target_id = 't2'").get() as { n: number }).n, 1);
});

await t.test('a send that is already in history is only marked as resolved', async () => {
  const now = new Date().toISOString();
  sqlite.prepare("INSERT INTO targets (id,company_name,source_type,dedupe_key,status,created_at,updated_at) VALUES ('t3','Already Sent Co','manual','email:dupe@example.test','waiting',?,?)").run(now, now);
  sqlite.prepare("INSERT INTO outbound_sends (id,target_id,to_email,subject,body_text,message_id,send_key,status,attempts,sent_at,created_at,updated_at) VALUES ('s2','t3','dupe@example.test','Already there','Body','<s2@example.test>','key-2','smtp_accepted_persist_failed',1,?,?,?)").run(now, now, now);
  sqlite.prepare("INSERT INTO threads (id,target_id,mailbox,subject,normalized_subject,status,created_at,updated_at) VALUES ('th3','t3','main','Already there','already there','waiting',?,?)").run(now, now);
  sqlite.prepare("INSERT INTO messages (id,thread_id,direction,from_email,to_email,subject,body_text,message_id,created_at) VALUES ('m3','th3','outbound','owner@example.test','dupe@example.test','Already there','Body','<s2@example.test>',?)").run(now);

  const form = new FormData();
  form.set('outboundSendId', 's2');
  form.set('targetId', 't3');
  try {
    await completeAcceptedSendAction(form);
  } catch (error) {
    assert.match(String(error), /static generation store missing in revalidatePath|NEXT_REDIRECT/);
  }

  assert.equal((sqlite.prepare("SELECT status FROM outbound_sends WHERE id = 's2'").get() as { status: string }).status, 'sent');
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM messages WHERE message_id = '<s2@example.test>'").get() as { n: number }).n, 1);
  const resolution = sqlite.prepare("SELECT payload_json AS payload FROM events WHERE event_type = 'send_record_recovered' ORDER BY created_at DESC LIMIT 1").get() as { payload: string };
  assert.equal((JSON.parse(resolution.payload) as { resolution: string }).resolution, 'message_already_saved');
  assert.equal((sqlite.prepare("SELECT thread_id FROM outbound_sends WHERE id = 's2'").get() as { thread_id: string }).thread_id, 'th3');
});

await t.test('recovering an older send preserves newer replies, drafts and follow-ups', async () => {
  const before = '2026-09-01T09:00:00.000Z';
  const sentAt = '2026-09-02T09:00:00.000Z';
  const later = '2026-09-03T09:00:00.000Z';
  sqlite.prepare("INSERT INTO targets (id,company_name,source_type,dedupe_key,status,created_at,updated_at) VALUES ('late-target','Late recovery','manual','late-recovery','replied',?,?)").run(before, later);
  const thread = sqlite.prepare("INSERT INTO threads (id,target_id,mailbox,subject,normalized_subject,last_message_id,last_inbound_at,next_followup_at,status,created_at,updated_at) VALUES (?,'late-target','main','Question','question','<reply@example.test>',?,?,'replied',?,?)");
  thread.run('original-thread', later, later, before, later);
  thread.run('newer-thread', later, later, later, '2026-09-04T09:00:00.000Z');
  const message = sqlite.prepare("INSERT INTO messages (id,thread_id,direction,from_email,to_email,subject,body_text,message_id,sent_at,created_at) VALUES (?,'original-thread','inbound','hello@example.test','owner@example.test','Question','Body',?,?,?)");
  message.run('previous-message', '<previous@example.test>', before, before);
  message.run('newer-reply', '<reply@example.test>', later, later);
  sqlite.prepare("INSERT INTO outbound_sends (id,target_id,thread_id,to_email,subject,body_text,message_id,send_key,status,attempts,sent_at,created_at,updated_at) VALUES ('late-send','late-target','original-thread','hello@example.test','Question','Sent body','<late@example.test>','late-key','smtp_accepted_persist_failed',1,?,?,?)").run(sentAt, sentAt, sentAt);
  sqlite.prepare("INSERT INTO events (id,entity_type,entity_id,event_type,payload_json,created_at) VALUES ('late-queued','target','late-target','send_queued',?,?)").run(JSON.stringify({ outboundSendId: 'late-send', from: 'Owner <owner@example.test>' }), sentAt);
  drafts.saveEmailDraft('late-target', { subject: 'New draft', body: 'Keep this work', fromEmail: 'owner@example.test' });
  const followup = sqlite.prepare("INSERT INTO followup_tasks (id,thread_id,target_id,due_at,status,created_at) VALUES (?,'original-thread','late-target',?,'open',?)");
  followup.run('old-followup', before, before);
  followup.run('new-followup', later, later);
  const form = new FormData();
  form.set('outboundSendId', 'late-send');
  form.set('targetId', 'late-target');
  await assert.rejects(completeAcceptedSendAction(form), /static generation store missing in revalidatePath|NEXT_REDIRECT/);

  const recovered = sqlite.prepare("SELECT thread_id, sent_at, in_reply_to FROM messages WHERE message_id = '<late@example.test>'").get();
  assert.deepEqual(recovered, { thread_id: 'original-thread', sent_at: sentAt, in_reply_to: '<previous@example.test>' });
  assert.equal(drafts.getEmailDraft('late-target')?.body, 'Keep this work');
  assert.equal((sqlite.prepare("SELECT status FROM targets WHERE id = 'late-target'").get() as { status: string }).status, 'replied');
  assert.deepEqual(sqlite.prepare("SELECT last_message_id, last_outbound_at, next_followup_at, status FROM threads WHERE id = 'original-thread'").get(), { last_message_id: '<reply@example.test>', last_outbound_at: sentAt, next_followup_at: later, status: 'replied' });
  assert.equal((sqlite.prepare("SELECT status FROM followup_tasks WHERE id = 'old-followup'").get() as { status: string }).status, 'completed');
  assert.equal((sqlite.prepare("SELECT status FROM followup_tasks WHERE id = 'new-followup'").get() as { status: string }).status, 'open');
  assert.equal((sqlite.prepare("SELECT created_at FROM events WHERE entity_id = 'late-target' AND event_type = 'email_sent'").get() as { created_at: string }).created_at, sentAt, 'analytics uses the actual send date');
});

await t.test('recovery stays retryable when its audit write fails and refuses an unknown sender', async () => {
  const now = new Date().toISOString();
  sqlite.prepare("INSERT INTO outbound_sends (id,target_id,to_email,subject,body_text,message_id,send_key,status,attempts,sent_at,created_at,updated_at) VALUES ('atomic-send','t1','ada@example.test','Atomic recovery','Body','<atomic@example.test>','atomic-key','smtp_accepted_persist_failed',1,?,?,?)").run(now, now, now);
  const form = new FormData();
  form.set('outboundSendId', 'atomic-send');
  form.set('targetId', 't1');
  await assert.rejects(completeAcceptedSendAction(form), /NEXT_REDIRECT/);
  assert.equal(recoverSend.messageRecordExists('<atomic@example.test>'), false, 'do not guess a sender from current settings');
  sqlite.prepare("INSERT INTO events (id,entity_type,entity_id,event_type,payload_json,created_at) VALUES ('atomic-queued','target','t1','send_queued',?,?)").run(JSON.stringify({ outboundSendId: 'atomic-send', from: 'Owner <owner@example.test>' }), now);
  sqlite.exec("CREATE TRIGGER fail_recovery_event BEFORE INSERT ON events WHEN NEW.event_type = 'send_record_recovered' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END");
  try {
    await assert.rejects(completeAcceptedSendAction(form), /static generation store missing in revalidatePath/);
    assert.equal(recoverSend.hasUnsavedAcceptedSend('t1'), true);
    assert.equal(recoverSend.messageRecordExists('<atomic@example.test>'), false, 'history and resolution roll back together');
    assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE entity_id = 't1' AND event_type = 'email_sent'").get() as { n: number }).n, 0);
  } finally {
    sqlite.exec('DROP TRIGGER fail_recovery_event');
  }

  const resend = new FormData();
  resend.set('targetId', 't1');
  resend.set('subject', 'Retry');
  resend.set('body', 'Must not be sent');
  await assert.rejects(sendNowAction(resend), /static generation store missing in revalidatePath/);
  const blocked = sqlite.prepare("SELECT payload_json FROM events WHERE entity_id = 't1' AND event_type = 'send_blocked' ORDER BY created_at DESC LIMIT 1").get() as { payload_json: string };
  assert.equal(JSON.parse(blocked.payload_json).reason, 'unsaved_accepted_send');
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM outbound_sends WHERE target_id = 't1'").get() as { n: number }).n, 1);
  sqlite.prepare("INSERT INTO targets (id,contact_id,company_name,source_type,dedupe_key,status,created_at,updated_at) VALUES ('same-contact','c1','Another opportunity','manual','same-contact','new',?,?)").run(now, now);
  assert.equal(recoverSend.hasUnsavedAcceptedSend('same-contact'), true, 'another target for the same recipient cannot bypass the guard');

  await assert.rejects(completeAcceptedSendAction(form), /static generation store missing in revalidatePath/);
  assert.equal(recoverSend.hasUnsavedAcceptedSend('t1'), false);
  assert.equal(recoverSend.hasUnsavedAcceptedSend('same-contact'), false);
  assert.equal(recoverSend.messageRecordExists('<atomic@example.test>'), true);
});

await t.test('due follow-ups are counted for the navigation badge', () => {
  const due = new Date(Date.now() - 60_000).toISOString();
  const before = getDueFollowupCount();
  sqlite.prepare("INSERT INTO followup_tasks (id,thread_id,target_id,due_at,status,created_at) VALUES ('f-due','th1','t1',?,'open',?)").run(due, new Date().toISOString());
  assert.equal(getDueFollowupCount(), before + 1);
  sqlite.prepare("UPDATE followup_tasks SET status = 'completed' WHERE id = 'f-due'").run();
  assert.equal(getDueFollowupCount(), before);
});

await t.test('a compressed backup is verified without touching the live database', async () => {
  const backupDir = path.join(directory, 'verify backups');
  const backup = await backupDatabase(sqlite, backupDir);

  const result = verifyBackupFile(backup);
  assert.equal(result.integrity, 'ok');
  assert.equal(result.schemaVersion, '0007');
  assert.equal(result.counts.contacts, (sqlite.prepare('SELECT count(*) AS n FROM contacts').get() as { n: number }).n);
  assert.equal(result.counts.targets, (sqlite.prepare('SELECT count(*) AS n FROM targets').get() as { n: number }).n);
  assert.equal(result.counts.messages, (sqlite.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n);

  const broken = path.join(backupDir, 'not-a-backup.sqlite.gz');
  writeFileSync(broken, 'plain text');
  assert.throws(() => verifyBackupFile(broken), /not a gzip-compressed backup/);
  assert.throws(() => verifyBackupFile(path.join(backupDir, 'missing.sqlite.gz')), /Backup file not found/);

  const foreignPath = path.join(backupDir, 'foreign.sqlite');
  const foreign = new Database(foreignPath);
  foreign.exec('CREATE TABLE notes (id TEXT)');
  foreign.close();
  const foreignArchive = path.join(backupDir, 'foreign.sqlite.gz');
  writeFileSync(foreignArchive, gzipSync(readFileSync(foreignPath)));
  assert.throws(() => verifyBackupFile(foreignArchive), /not a complete ReachLog backup/);
  const emptyArchive = path.join(backupDir, 'empty.sqlite.gz');
  writeFileSync(emptyArchive, gzipSync(Buffer.alloc(0)));
  assert.throws(() => verifyBackupFile(emptyArchive), /not a complete ReachLog backup/);

  const junkArchive = path.join(backupDir, 'junk.sqlite.gz');
  writeFileSync(junkArchive, gzipSync(Buffer.from('this is not a database, only text')));
  assert.throws(
    () => verifyBackupFile(junkArchive),
    /SQLite could not check this backup|not a readable SQLite database/
  );
});

await t.test('CLI rejects unsafe network exposure and invalid input before creating data', async () => {
  const cli = path.join(directory, 'cli.cjs');
  buildSync({ entryPoints: ['src/cli.ts'], outfile: cli, bundle: true, platform: 'node', format: 'cjs', external: ['next/dist/bin/next', 'better-sqlite3'] });
  const env: NodeJS.ProcessEnv = { ...process.env, APP_URL: '', APP_BASIC_AUTH_ENABLED: 'false' };
  // The bundle is executed from a temporary folder, so point module resolution at this checkout.
  env.NODE_PATH = path.join(process.cwd(), 'node_modules');
  delete env.APP_URL;
  const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
  assert.match(run(['--help']).stdout, /mail-sync/);
  assert.match(run(['--port', 'NaN']).stderr, /Port must/);
  assert.match(run(['--host', '0.0.0.0']).stderr, /Network access requires/);
  assert.match(run(['demo', '--host', '0.0.0.0']).stderr, /Network access requires/);
  assert.match(run(['worker', 'unknown']).stderr, /Invalid arguments/);
  assert.match(run(['--env-file', path.join(directory, 'missing.env')]).stderr, /not found/);

  const backup = await backupDatabase(sqlite, path.join(directory, 'cli backups'));
  const verified = run(['verify-backup', backup]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /Integrity check: ok/);
  assert.match(verified.stdout, /Schema version: 0007/);
  assert.match(run(['verify-backup']).stderr, /Usage: reachlog verify-backup/);
  const missing = run(['verify-backup', path.join(directory, 'missing.sqlite.gz')]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Backup file not found/);
  const foreign = run(['verify-backup', path.join(directory, 'verify backups', 'foreign.sqlite.gz')]);
  assert.notEqual(foreign.status, 0);
  assert.match(foreign.stderr, /not a complete ReachLog backup/);
  assert.doesNotMatch(foreign.stdout, /Backup verified/);
});

});
