import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const installed = path.resolve(process.argv[2] ?? 'node_modules/reachlog');
const cli = path.join(installed, 'dist/cli.cjs');
const directory = await mkdtemp(path.join(tmpdir(), 'reachlog-smoke-'));
const port = Number(process.argv[3] ?? 3219);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, APP_URL: base, APP_BASIC_AUTH_ENABLED: 'false', SMTP_ENABLED: 'false', IMAP_ENABLED: 'false', TELEGRAM_ENABLED: 'false', EMAILLISTVERIFY_ENABLED: 'false', DEMO_MODE: 'false', SEED_DEMO_DATA: 'false' };
for (const key of ['DATABASE_PATH', 'BACKUP_DIR', 'DOTENV_CONFIG_PATH']) delete env[key];
let app;
let log = '';
const decode = (s) => s.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w$:-]+)="([^"]*)"/g)].map((match) => [match[1], decode(match[2])]));
const forms = (html) => [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map((match) => match[1]);

async function start(command = 'start', overrides = {}) {
  log = '';
  app = spawn(process.execPath, [cli, command, '--port', String(port), '--data-dir', directory], { env: { ...env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout.on('data', (chunk) => { log += chunk; });
  app.stderr.on('data', (chunk) => { log += chunk; });
  for (let i = 0; i < 100; i++) {
    if (log.includes('Ready')) return;
    if (app.exitCode !== null) throw new Error(log);
    await delay(100);
  }
  throw new Error(`App did not start: ${log}`);
}
async function stop() {
  if (!app || app.exitCode !== null) return;
  const exited = once(app, 'exit');
  app.kill('SIGTERM');
  await exited;
}
async function get(route, options = {}) {
  const response = await fetch(base + route, options);
  assert.equal(response.status, 200, `${route}: ${response.status}; ${log}`);
  return response;
}
async function submit(route, form, values, buttonText) {
  assert.ok(form, 'Expected rendered form');
  const data = new FormData();
  for (const tag of form.matchAll(/<input\b[^>]*>/g)) {
    const field = attrs(tag[0]);
    if (field.type === 'hidden' && field.name) data.set(field.name, field.value ?? '');
  }
  if (buttonText) {
    const button = [...form.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find((match) => match[2].includes(buttonText));
    assert.ok(button, `Missing ${buttonText} button`);
    const field = attrs(button[1]);
    if (field.name?.startsWith('$ACTION_')) {
      for (const key of [...data.keys()]) if (key.startsWith('$ACTION_ID_')) data.delete(key);
      data.set(field.name, field.value ?? '');
    }
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  const response = await fetch(base + route, { method: 'POST', body: data, redirect: 'manual', headers: { origin: base } });
  assert.equal(response.status, 303, `Form returned ${response.status}: ${await response.text()}; ${log}`);
  return response.headers.get('location');
}

try {
  await start();
  const dashboard = await (await get('/dashboard')).text();
  assert.match(dashboard, /Start tracking your outreach/);
  const assets = [...new Set([...dashboard.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map((match) => decode(match[1])))];
  assert.ok(assets.some((asset) => asset.endsWith('.css')));
  assert.ok(assets.some((asset) => asset.endsWith('.js')));
  for (const asset of assets) await get(asset);
  for (const route of ['/targets', '/followups', '/analytics', '/import', '/settings/modules']) await get(route);
  console.log(`PASS: empty startup, app routes and ${assets.length} static assets`);

  const create = await (await get('/targets?showCreate=1')).text();
  const location = await submit('/targets?showCreate=1', forms(create).find((form) => form.includes('name="companyName"')), { companyName: 'Release test company', email: 'contact@example.test', contactName: 'Test contact', sourceType: 'manual', status: 'new' });
  const targetId = location.split('/').pop();
  assert.match(await (await get(location)).text(), /Release test company/);
  const composeUrl = `/targets?sendTargetId=${encodeURIComponent(targetId)}`;
  const compose = await (await get(composeUrl)).text();
  const draftBody = 'A retained draft.\nSecond line — Unicode.';
  const saved = await submit(composeUrl, forms(compose).find((form) => form.includes('name="targetId"')), { targetId, subject: 'Saved release draft', body: draftBody, returnTo: '/targets', fromEmail: 'me@example.local' }, 'Save draft');
  const reopened = await (await get(composeUrl)).text();
  assert.match(decodeURIComponent(saved), /Draft.saved/);
  assert.ok(reopened.replaceAll("\r\n", "\n").includes(draftBody));
  assert.match(reopened, /Saved release draft/);
  const targets = await (await get('/api/export/targets?format=json')).json();
  assert.equal(targets.count, 1);
  assert.equal((await (await get('/api/export/messages?format=json')).json()).count, 0);
  console.log('PASS: create contact, save/reopen draft, export, no mail sent');

  await stop();
  await start();
  assert.ok((await (await get(composeUrl)).text()).replaceAll("\r\n", "\n").includes(draftBody));
  await stop();
  const backup = spawn(process.execPath, [cli, 'worker', 'backup', '--data-dir', directory], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let backupLog = '';
  backup.stdout.on('data', (chunk) => { backupLog += chunk; });
  backup.stderr.on('data', (chunk) => { backupLog += chunk; });
  assert.equal((await once(backup, 'exit'))[0], 0, backupLog);
  assert.ok((await readdir(path.join(directory, 'backups'))).some((file) => file.endsWith('.sqlite.gz')));
  console.log('PASS: restart persistence and packaged backup worker');

  await start('demo');
  const demoTargets = await (await get('/api/export/targets?format=json')).json();
  assert.equal(demoTargets.count, 4);
  const demoUrl = '/targets?sendTargetId=target-acme';
  const demoCompose = await (await get(demoUrl)).text();
  assert.match(demoCompose, /nothing is sent/);
  const sent = await submit(demoUrl, forms(demoCompose).find((form) => form.includes('name="targetId"')), { targetId: 'target-acme', subject: 'Local simulation', body: 'Demo test only', fromEmail: 'me@example.local', returnTo: '/targets', followupDays: '5' });
  assert.match(decodeURIComponent(sent), /simulated/);
  await stop();
  console.log('PASS: separate demo data and simulated send');

  const password = 'test-only-' + Date.now();
  await start('start', { APP_BASIC_AUTH_ENABLED: 'true', APP_BASIC_AUTH_USER: 'test-owner', APP_BASIC_AUTH_PASSWORD: password });
  assert.equal((await fetch(base + '/dashboard')).status, 401);
  assert.equal((await fetch(base + '/api/export/targets')).status, 401);
  assert.equal((await fetch(base + '/dashboard', { headers: { 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware' } })).status, 401);
  const authorization = `Basic ${Buffer.from(`test-owner:${password}`).toString('base64')}`;
  const original = await (await get('/api/export/targets?format=json', { headers: { authorization } })).json();
  assert.equal(original.count, 1);
  console.log('PASS: authentication protects pages and exports; demo leaves real data unchanged');
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
