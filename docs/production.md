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
DATABASE_PATH=/data/outreach-crm/app.sqlite
BACKUP_DIR=/data/outreach-crm/backups
B2_REMOTE=b2:your-bucket/outreach-crm/

APP_BASIC_AUTH_ENABLED=true
APP_BASIC_AUTH_USER=owner
APP_BASIC_AUTH_PASSWORD=use-a-long-random-password
```

Store production env in `/etc/reachlog.env` owned by root:

```bash
chmod 600 /etc/reachlog.env
```

The database and backups should be owned by the service user:

```bash
mkdir -p /data/outreach-crm/backups
chown -R reachlog:reachlog /data/outreach-crm
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
                                  -> /data/outreach-crm/app.sqlite
                                  -> Forge scheduled jobs
                                  -> Proton Bridge on the same VDS
```

### 1. Create The Forge Site

Create a normal Forge site, for example:

```text
reachlog.example.com
```

Install the Git repository into:

```text
/home/forge/reachlog.example.com
```

Use a dedicated port so it does not collide with anything else:

```text
PORT=3007
```

### 2. Forge Environment

In Forge's environment editor for the site, set:

```text
NODE_ENV=production
PORT=3007
DATABASE_PATH=/data/outreach-crm/app.sqlite
BACKUP_DIR=/data/outreach-crm/backups
B2_REMOTE=b2:your-bucket/outreach-crm/

APP_BASIC_AUTH_ENABLED=true
APP_BASIC_AUTH_USER=owner
APP_BASIC_AUTH_PASSWORD=use-a-long-random-password

SMTP_ENABLED=false
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

IMAP_ENABLED=false
IMAP_HOST=127.0.0.1
IMAP_PORT=1143
IMAP_USER=
IMAP_PASS=

TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Turn `SMTP_ENABLED` and `IMAP_ENABLED` on only after Proton Bridge is installed
and tested on the VDS.

### 3. Deployment Script

Run this one-time setup over SSH first:

```bash
sudo mkdir -p /data/outreach-crm/backups
sudo chown -R forge:forge /data/outreach-crm
```

Use this as the Forge deployment script:

```bash
cd /home/forge/reachlog.example.com

npm ci
npm run build
mkdir -p .next/standalone/.next
cp -R .next/static .next/standalone/.next/static
if [ -d public ]; then cp -R public .next/standalone/public; fi

echo "ReachLog deployed."
```

Do not start the app in the deployment script. Forge should keep it running as
a daemon.

### 4. Forge Daemon

Create a Forge daemon:

```text
Directory: /home/forge/reachlog.example.com
Command: npm run start
User: forge
```

Because `PORT=3007` is in the Forge environment, the standalone Next server
binds to `127.0.0.1:3007` when Nginx proxies to it. The package `start` script
pins the hostname to `127.0.0.1`, so the Node server is not exposed directly on
the VDS public interface.

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
cd /home/forge/reachlog.example.com && npm run worker:mail-sync
```

Every 15 minutes:

```bash
cd /home/forge/reachlog.example.com && npm run worker:followup-check
```

Daily, for example 03:20:

```bash
cd /home/forge/reachlog.example.com && npm run worker:backup
```

### 7. Forge Versus systemd

If you use Forge daemons and scheduled jobs, you do not need the systemd files.
The files in `deploy/systemd/` are for non-Forge deployments or for a server
where you prefer managing services manually.

## Backups

The backup worker uses SQLite `VACUUM INTO`, gzips the snapshot, and copies the
backup directory to `B2_REMOTE` when configured.

Restore test:

```bash
gunzip -c /data/outreach-crm/backups/app-YYYY-MM-DD.sqlite.gz > /tmp/reachlog-restore.sqlite
DATABASE_PATH=/tmp/reachlog-restore.sqlite npm run worker:followup-check
```

The restore test should open the database and exit cleanly.

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
