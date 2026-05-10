# Production Runbook

ReachLog is designed to run as a private single-user app. It has built-in
HTTP Basic Auth for the one-user case, and you can still put Cloudflare Access
or Nginx auth in front of it as an extra gate.

## Required Shape

```text
HTTPS access gate -> Forge Nginx/Caddy/Cloudflare -> Next.js app
                                      |
                                      -> SQLite WAL database
                                      -> systemd worker timers
                                      -> Proton Bridge IMAP/SMTP
                                      -> daily B2 backup
```

Do not expose the Next.js server directly to the public internet.

## Environment

Use absolute production paths:

```text
TZ=Asia/Bangkok
DATABASE_PATH=/home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/app.sqlite
BACKUP_DIR=/home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/backups
B2_REMOTE=b2:your-bucket/outreach-crm/
SEED_DEMO_DATA=false

APP_BASIC_AUTH_ENABLED=true
APP_BASIC_AUTH_USER=owner
APP_BASIC_AUTH_PASSWORD=use-a-long-random-password
```

Store production env in `/etc/reachlog.env` owned by root:

```bash
chmod 600 /etc/reachlog.env
```

The database and backups should live in a stable directory owned by the service
user. On Forge with an isolated site user, do not use `/data` unless you have
explicitly created and chowned it. Prefer the site-owned `shared/data`
directory:

```bash
mkdir -p /home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/backups
```

## Build And Run

```bash
npm ci
npm run build
sudo cp deploy/systemd/reachlog*.service /etc/systemd/system/
sudo cp deploy/systemd/reachlog*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now reachlog.service
sudo systemctl enable --now reachlog-mail-sync.timer
sudo systemctl enable --now reachlog-followup-check.timer
sudo systemctl enable --now reachlog-backup.timer
```

Run production with `npm run start`, never `npm run dev`.

## Access Gate

The app has built-in Basic Auth controlled by:

```text
APP_BASIC_AUTH_ENABLED=true
APP_BASIC_AUTH_USER=owner
APP_BASIC_AUTH_PASSWORD=...
```

When enabled, every app route requires a browser username/password prompt.
Static Next.js assets are excluded so the app can render normally after login.

You can also use Cloudflare Access, Caddy, or Nginx auth in front. For Caddy,
see:

```text
deploy/caddy/Caddyfile.example
```

If using Caddy `basic_auth`, generate a hash with:

```bash
caddy hash-password --plaintext 'your-password'
```

## Laravel Forge Deployment

Forge is a good fit for this app because it already manages the VDS, Nginx,
TLS, deploys, daemons, and scheduled jobs.

Recommended Forge shape:

```text
Forge Nginx TLS site -> 127.0.0.1:3007 Next.js daemon
                                  |
                                  -> /home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/app.sqlite
                                  -> Forge scheduled jobs
                                  -> Proton Bridge on the same VDS
```

### 1. Create The Forge Site

Create a normal Forge site, for example:

```text
reachlog-pzjckw1w.on-forge.com
```

Install the Git repository into:

```text
/home/reach-log/reachlog-pzjckw1w.on-forge.com
```

Use a dedicated port so it does not collide with anything else:

```text
PORT=3007
```

### 2. Forge Environment

In Forge's environment editor for the site, set:

```text
NODE_ENV=production
TZ=Asia/Bangkok
PORT=3007
DATABASE_PATH=/home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/app.sqlite
BACKUP_DIR=/home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/backups
B2_REMOTE=b2:your-bucket/outreach-crm/
SEED_DEMO_DATA=false

APP_BASIC_AUTH_ENABLED=true
APP_BASIC_AUTH_USER=owner
APP_BASIC_AUTH_PASSWORD=use-a-long-random-password

SMTP_ENABLED=false
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

IMAP_ENABLED=false
IMAP_HOST=127.0.0.1
IMAP_PORT=1143
IMAP_SECURE=false
IMAP_USER=
IMAP_PASS=
IMAP_MAILBOXES=INBOX,Sent
IMAP_LOOKBACK_DAYS=90

TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

EMAILLISTVERIFY_ENABLED=false
EMAILLISTVERIFY_API_KEY=
EMAILLISTVERIFY_TIMEOUT_MS=15000
EMAILLISTVERIFY_BATCH_SIZE=25
```

Turn `SMTP_ENABLED` and `IMAP_ENABLED` on only after Proton Bridge is installed
and tested on the VDS.

`SEED_DEMO_DATA` must stay `false` in production. Set it to `true` only for a
throwaway demo database.

The repository also includes `.env.production.example` with the same
absolute-path defaults.

### 3. Deployment Script

Run this one-time setup over SSH first:

```bash
mkdir -p /home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/backups
```

The SQLite directory must be writable by `reach-log`. Do not put the database
under `releases/` because deploys rotate that directory. If ownership is wrong,
repair it once:

```bash
sudo chown -R reach-log:reach-log /home/reach-log/reachlog-pzjckw1w.on-forge.com/shared
```

Use this as the Forge deployment script:

```bash
cd /home/reach-log/reachlog-pzjckw1w.on-forge.com

npm ci
npm run prod:check
npm run build
mkdir -p .next/standalone/.next
cp -R .next/static .next/standalone/.next/static
if [ -d public ]; then cp -R public .next/standalone/public; fi

echo "ReachLog deployed."
```

Do not start the app in the deployment script. Forge should keep it running as
a daemon.

If you imported a canonical CSV where the historical date is embedded in the
summary text as `date=YYYY-MM-DD`, deploy the timestamp parser fix and run this
one-time backfill:

```bash
cd /home/reach-log/reachlog-pzjckw1w.on-forge.com
npm run worker:backup
npm run prod:backfill-source-timestamps
```

Export events/contact forms again afterward and confirm historical rows no
longer all show the import timestamp.

### 4. Forge Daemon

Create a Forge daemon:

```text
Directory: /home/reach-log/reachlog-pzjckw1w.on-forge.com
Command: npm run start
User: reach-log
```

Because `PORT=3007` is in the Forge environment, the standalone Next server
binds to `127.0.0.1:3007` when Nginx proxies to it. The package `start` script
pins the hostname to `127.0.0.1`, so the Node server is not exposed directly on
the VDS public interface.

If PM2 logs show this warning:

```text
"next start" does not work with "output: standalone" configuration.
```

the Forge process is still running the wrong command. Change the daemon/start
command to either:

```bash
npm run start
```

or the direct standalone command:

```bash
HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

Then restart the Forge daemon/PM2 process. Do not use `next start` for this
project.

### 5. Forge Nginx Proxy

In the Forge Nginx config for the site, replace the PHP/Laravel location block
with a reverse proxy to the Next app:

```nginx
location / {
    proxy_pass http://127.0.0.1:3007;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120;
}
```

Let Forge issue and renew the TLS certificate.

### 6. Forge Scheduled Jobs

Add these scheduled jobs in Forge. The app has SQLite worker locks, so overlap
is skipped instead of running the same worker twice.

Every minute:

```bash
cd /home/reach-log/reachlog-pzjckw1w.on-forge.com && npm run worker:mail-sync
```

Every 15 minutes:

```bash
cd /home/reach-log/reachlog-pzjckw1w.on-forge.com && npm run worker:followup-check
```

Every 10-15 minutes if EmailListVerify is enabled:

```bash
cd /home/reach-log/reachlog-pzjckw1w.on-forge.com && npm run worker:email-verify
```

Daily, for example 03:20:

```bash
cd /home/reach-log/reachlog-pzjckw1w.on-forge.com && npm run worker:backup
```

### 7. Forge Versus systemd

If you use Forge daemons and scheduled jobs, you do not need the systemd files.
The files in `deploy/systemd/` are for non-Forge deployments or for a server
where you prefer managing services manually.

## Backups

The backup worker uses SQLite `VACUUM INTO`, gzips the snapshot, and copies the
backup directory to `B2_REMOTE` when configured.

Install and test the required CLI tools on the VDS:

```bash
npm run prod:check
which sqlite3
which gzip
which rclone
sqlite3 --version
rclone lsd b2:
```

Restore test:

```bash
gunzip -c /home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/backups/app-YYYY-MM-DD.sqlite.gz > /tmp/reachlog-restore.sqlite
DATABASE_PATH=/tmp/reachlog-restore.sqlite npm run worker:followup-check
```

The restore test should open the database and exit cleanly.

## Proton Bridge Mailboxes

Before enabling IMAP sync, list the mailbox names exposed by Proton Bridge:

```bash
cd /home/reach-log/reachlog-pzjckw1w.on-forge.com && npm run worker:list-mailboxes
```

Set the folders explicitly:

```text
IMAP_MAILBOXES=INBOX,Sent
```

The first sync uses `IMAP_LOOKBACK_DAYS=90` by default. This avoids importing
years of old mailbox history on first production boot. Set it to `0` only if
you intentionally want to scan all existing mail.

## Operational Checks

```bash
systemctl status reachlog.service
systemctl list-timers 'reachlog-*'
journalctl -u reachlog.service -n 100
journalctl -u reachlog-mail-sync.service -n 100
journalctl -u reachlog-backup.service -n 100
```

The app records failed SMTP sends in `outbound_sends` and shows them on the
dashboard. Worker failures send Telegram notifications when Telegram is enabled.

## Data Exports

The app exposes CSV and JSON downloads behind the same Basic Auth gate:

```text
/api/export/targets?format=csv
/api/export/targets?format=json
/api/export/messages?format=csv
/api/export/followups?format=csv
/api/export/events?format=csv
/api/export/contact-forms?format=csv
/api/export/outbound-sends?format=csv
```

Targets support `q`, `status`, `source`, `domain`, and `flag`. Messages support
`targetId` and `direction`. Follow-ups support `filter=due|overdue|upcoming|all`.
