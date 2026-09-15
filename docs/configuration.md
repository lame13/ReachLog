# Configuration and hosting

SMTP, IMAP, and Telegram can be configured in **Settings → Connections**. Changes saved there take effect immediately in the web app and future worker runs. Save, test the connection, and explicitly enable the features you need. IMAP tests list available mailboxes so you can select the right Inbox and Sent folders.

The CLI also reads `~/.reachlog/.env` by default, or `<data-dir>/.env` when `--data-dir` is supplied. `--env-file` selects a different file. Precedence is shell environment, then `.env`, then saved connection settings, then application defaults. Environment-controlled fields are read-only in Settings. Changes to shell or `.env` values require restarting the app and its workers. To move a connection into the UI, remove its environment values and restart first.

Use `examples/reachlog.env.example` as a starting point. It contains no credentials. Store the completed file outside the npm installation and restrict access to your account.

Saved connections live in `<data-dir>/connections.json` with owner-only file permissions on POSIX systems. Secrets are stored locally as plaintext and are omitted from browser responses, database exports, and SQLite backups. Protect and back up this file separately with the same care as `.env`. Blank password inputs keep their saved values. A changed connection invalidates its previous test result. Demo uses a separate configuration path and disables connection changes and tests.

## Local storage

| Setting | CLI default | Purpose |
| --- | --- | --- |
| `REACHLOG_DATA_DIR` | `~/.reachlog` | Database and configuration folder |
| `DATABASE_PATH` | `app.sqlite` | Database path, relative to the data folder |
| `BACKUP_DIR` | `backups` | Backup folder, relative to the data folder |
| `TZ` | `UTC` | Timezone for dates and follow-ups |
| `APP_URL` | Local listener URL | Links in notifications |
| `REACHLOG_HOST` | `127.0.0.1` | Listener address |
| `PORT` | `3000` | Listener port |

Use an IANA timezone such as `Europe/London` or `Asia/Bangkok`. CLI flags override the corresponding host, port and data-directory variables.

Demo always uses `<data-dir>/demo.sqlite`, independently of `DATABASE_PATH`. It cannot send mail, sync a mailbox, call verification services or send notifications. Backups are skipped in demo. The ordinary CLI starts with an empty database and does not seed demo records.

Source development uses `.data/` in the checkout by default. If moving an existing installation, keep its database path explicit. The CLI uses the selected data directory without guessing a hosting path. Create a backup before switching versions.

## SMTP

```dotenv
SMTP_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_TLS_VERIFY=true
SMTP_USER=your-user
SMTP_PASS=your-password
SMTP_FROM=Your Name <you@example.com>
```

Use `SMTP_SECURITY=tls` for implicit TLS, commonly port 465; `starttls` requires an encrypted upgrade, `auto` negotiates it when offered, and `plain` disables it for a local test relay. Legacy `SMTP_SECURE` remains supported. For local Proton Bridge, use the host, port, username and password shown by Bridge, or choose its preset in Settings. Typical local ports are 1025 for SMTP and 1143 for IMAP. Bridge must be running on the same machine or a trusted private network.

A self-signed local Bridge certificate may require `SMTP_TLS_VERIFY=false` and `IMAP_TLS_VERIFY=false`. Keep verification enabled for ordinary remote mail servers.

Multiple sender identities use a pipe-separated list:

```dotenv
SMTP_FROM_IDENTITIES=Your Name <you@example.com>|Support <support@example.com>
```

For identities requiring separate SMTP credentials, append `::username::password` to an entry. The selector does not change the SMTP host or port. Sender addresses must be authorized by your mail provider.

The app sends only when you submit a message. Saving a draft stores the subject, body and selected sender locally. A successful send removes that draft. A failed send retains it. Do-not-contact and blocked-address checks still apply.

If your mail server accepts a message but ReachLog cannot finish writing its local record, the send appears under **Sending needs review** on the dashboard. Use **Save to history** to record the accepted message without sending it again, or **Mark checked** once you have handled it another way. Sending to that contact stays blocked until one of the two is done. Recovered messages keep the original sender and timestamp, and no follow-up is scheduled automatically.

## IMAP

```dotenv
IMAP_ENABLED=true
IMAP_HOST=imap.example.com
IMAP_PORT=993
IMAP_SECURITY=tls
IMAP_TLS_VERIFY=true
IMAP_USER=your-user
IMAP_PASS=your-password
IMAP_MAILBOXES=INBOX,Sent
IMAP_LOOKBACK_DAYS=90
IMAP_AUTO_RESYNC_DAYS=90
```

For Proton Bridge, use `IMAP_SECURITY=starttls` and its local IMAP port. Mailbox names must match the server:

```sh
reachlog worker list-mailboxes
reachlog worker mail-sync
reachlog worker mail-resync
```

Resync looks back 30 days unless `MAIL_SYNC_RESYNC_DAYS` is set. Imports that add email targets request a later automatic resync. Message IDs prevent duplicate imports. Messages are attached using reply headers, participants, domains and subjects; review ambiguous matches.

## Optional notifications and address checks

Telegram requires a bot token and chat ID, configured in Settings or with `TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. **Test connection** checks bot and chat access without sending a message. **Send test notification** sends a real notification to that chat. Reply and due-date notifications can contain contact details and message excerpts.

EmailListVerify requires `EMAILLISTVERIFY_ENABLED=true` and `EMAILLISTVERIFY_API_KEY`. Addresses are sent to that service for verification. Optional settings: `EMAILLISTVERIFY_TIMEOUT_MS=15000`, `EMAILLISTVERIFY_BATCH_SIZE=25`.

## Scheduled tasks

Built-in scheduling starts with the packaged CLI and `npm run dev`. Enable each schedule under **Settings → Background tasks**. Default intervals are five minutes for mailbox sync, fifteen minutes for follow-up reminders, and one day for backups. Intervals can be changed from one minute to one week. New installations and upgrades leave every schedule paused. Mail sync requires IMAP to be enabled; follow-up reminders require Telegram.

**Run now** queues an enabled task for the next scheduler tick, normally within five seconds. The page refreshes run status while visible. Each task retains its last successful run even if a later attempt fails. Pausing prevents future runs but lets current work finish. The scheduler stops its workers when ReachLog stops, records interrupted runs, and retries due work after restart. Overdue intervals are coalesced into one run. Only one scheduler owns a database at a time, and worker leases prevent overlapping runs with external workers. Scheduled SMTP sending is not supported.

For external scheduling, use `reachlog --no-scheduler` or `REACHLOG_SCHEDULER_ENABLED=false`. Each one-shot worker still runs once and exits. For example:

| Command | Suggested interval |
| --- | --- |
| `reachlog worker mail-sync` | Every 5 minutes |
| `reachlog worker followup-check` | Hourly |
| `reachlog worker email-verify` | Every 15 minutes, if enabled |
| `reachlog worker backup` | Daily |

Pass the same `--data-dir` and `--env-file` to every job. Workers use renewable database locks to avoid overlapping work; mail-sync, follow-up, and backup workers exit with code 75 when another worker already holds their lock. Follow-up checks notify you; they do not email contacts automatically.

## Network access

```dotenv
APP_URL=https://reachlog.example.com
APP_BASIC_AUTH_ENABLED=true
APP_BASIC_AUTH_USER=owner
APP_BASIC_AUTH_PASSWORD=replace-with-a-long-random-password
```

Serve HTTPS through your existing reverse proxy. Keep ReachLog bound to `127.0.0.1`, and proxy to its configured port. Plain Basic Auth over a public HTTP connection does not protect credentials in transit. The CLI refuses a network bind or public `APP_URL` without configured authentication.

To access it on a trusted network, use `reachlog --host 0.0.0.0` after configuring authentication. There are no team roles or account recovery. Protect the configuration file and SQLite database with operating-system permissions.

## Backup and restore

```sh
reachlog worker backup
```

Backups are consistent SQLite snapshots, compressed with Node.js. No `sqlite3` or `gzip` command is needed. Each filename is unique, including repeated backups on the same day. Backups are retained until you remove them.

Check an archive before restoring it:

```sh
reachlog verify-backup ~/.reachlog/backups/app-2026-09-06T09-00-00-000Z-1a2b3c4d.sqlite.gz
```

The command decompresses the archive into a temporary folder, runs SQLite's integrity check, and prints the schema version plus the number of contacts, targets, threads, messages, open follow-ups and recorded sends. It never writes to your live database or configuration, exits with a non-zero status for damaged archives or missing ReachLog tables, and removes the temporary copy afterwards. Compare the record counts with the installation you are replacing before you swap directories.

Optional `B2_REMOTE` runs `rclone copy` after the local backup. This requires an installed and configured `rclone` and transmits the backups to that destination. It is disabled by default.

To restore:

1. Stop ReachLog and its scheduled tasks.
2. Run `reachlog verify-backup /path/to/chosen-backup.sqlite.gz` and confirm the reported counts match what you expect.
3. Decompress the chosen `.sqlite.gz` backup into a new directory as `app.sqlite`.
4. Start `reachlog --data-dir /path/to/restored-directory` with connections disabled and inspect the records.
5. Add the appropriate configuration and resume work only after verifying the restoration.

Keep the previous database intact until the restoration is verified. Do not copy an open SQLite database with a plain file copy while writes may be in progress.
