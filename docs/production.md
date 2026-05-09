# Production Runbook

ReachLog is designed to run as a private single-user app behind an external
access gate.

## Required Shape

```text
HTTPS access gate -> Caddy/Cloudflare Access -> Next.js app
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

Use Cloudflare Access, or use the Caddy example in:

```text
deploy/caddy/Caddyfile.example
```

If using Caddy `basic_auth`, generate a hash with:

```bash
caddy hash-password --plaintext 'your-password'
```

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
