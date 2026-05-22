# ReachLog

ReachLog is a private outreach command center:

```text
targets -> outreach events -> email threads -> follow-up tasks -> dedupe protection -> analytics
```

It is intentionally a modular monolith, not a generic sales CRM and not a microservice system. The app is built for one owner, one private deployment, and a small amount of high-signal outreach data.

## What It Does

- Tracks outreach targets, contacts, companies, domains, source URLs, statuses, and dedupe keys.
- Imports canonical outreach CSVs with dedupe preview before insert.
- Preserves historical outreach context in events: subject, body/summary, notes, next action, follow-up date, and source timestamp.
- Stores email threads and messages from Proton Bridge IMAP.
- Sends email through Proton Bridge SMTP from one or more configured sender identities.
- Creates manual follow-up tasks and keeps due/overdue/upcoming queues.
- Prevents duplicate outreach with unique contact, target, message, and contact-form dedupe keys.
- Verifies newly added emails through EmailListVerify when enabled.
- Sends Telegram notifications for replies, due follow-ups, worker failures, backup failures, and test messages.
- Exports targets, messages, follow-ups, events, contact forms, and outbound sends as CSV or JSON.
- Runs on SQLite first, with daily safe backups via `VACUUM INTO`.

## Stack

- Next.js App Router
- TypeScript
- React
- Tailwind CSS
- Drizzle ORM
- SQLite
- Node worker scripts
- Proton Bridge-compatible IMAP/SMTP
- Optional Telegram module
- Optional EmailListVerify module

## Current Production Shape

The intended Forge/VDS production paths are:

```text
APP_URL=https://reachlog-pzjckw1w.on-forge.com
DATABASE_PATH=/home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/app.sqlite
BACKUP_DIR=/home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/backups
```

The database must live in `shared/data`, not inside a release directory. Forge purges old releases, so release-local files like `releases/.../.data/app.sqlite` are stale artifacts and should not be used.

## Quick Start

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Local SQLite defaults to:

```text
.data/app.sqlite
```

Run a local demo database:

```bash
npm run demo:reset
npm run demo:dev
```

Demo mode uses `.data/demo.sqlite`, seeds sample outreach data, shows a demo
banner, simulates email sends into the database, and skips real SMTP, IMAP,
Telegram, EmailListVerify, and backup side effects.

Copy env examples as needed:

```bash
cp .env.example .env.local
```

For Forge/VDS production, use `.env.production.example` as the starting point.

## Important Env

Core:

```text
TZ=Asia/Bangkok
APP_URL=https://reachlog-pzjckw1w.on-forge.com
DEMO_MODE=false
DATABASE_PATH=/home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/app.sqlite
BACKUP_DIR=/home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/backups
SEED_DEMO_DATA=false
```

Public demo:

```text
DEMO_MODE=true
DATABASE_PATH=/home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/demo/app.sqlite
BACKUP_DIR=/home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/demo/backups
SEED_DEMO_DATA=true
APP_BASIC_AUTH_ENABLED=false
SMTP_ENABLED=false
IMAP_ENABLED=false
TELEGRAM_ENABLED=false
EMAILLISTVERIFY_ENABLED=false
```

Reset the demo data when needed:

```bash
npm run demo:reset
```

Single-owner auth:

```text
APP_BASIC_AUTH_ENABLED=true
APP_BASIC_AUTH_USER=owner
APP_BASIC_AUTH_PASSWORD=use-a-long-random-password
```

SMTP through Proton Bridge:

```text
SMTP_ENABLED=true
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_TLS_VERIFY=false
SMTP_USER=your-bridge-user
SMTP_PASS=your-bridge-password
SMTP_FROM_IDENTITIES=Niko <niko@wpfixpath.work>|Niko <niko@indexlane.dev>
```

`SMTP_SECURE=false` means the connection does not start with implicit TLS. Proton Bridge may still advertise STARTTLS after connect; `SMTP_TLS_VERIFY=false` disables certificate verification for Bridge's local self-signed certificate.

Multiple sender identities can share the same Bridge credentials, as above. If a sender ever needs separate SMTP credentials:

```text
SMTP_FROM_IDENTITIES=Niko <niko@wpfixpath.work>::bridge-user-1::bridge-pass-1|Niko <niko@indexlane.dev>::bridge-user-2::bridge-pass-2
```

IMAP through Proton Bridge:

```text
IMAP_ENABLED=true
IMAP_HOST=127.0.0.1
IMAP_PORT=1143
IMAP_SECURITY=starttls
IMAP_TLS_VERIFY=false
IMAP_USER=your-bridge-user
IMAP_PASS=your-bridge-password
IMAP_MAILBOXES=INBOX,Sent
IMAP_LOOKBACK_DAYS=90
IMAP_AUTO_RESYNC_DAYS=90
```

Telegram:

```text
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

EmailListVerify:

```text
EMAILLISTVERIFY_ENABLED=true
EMAILLISTVERIFY_API_KEY=
EMAILLISTVERIFY_TIMEOUT_MS=15000
EMAILLISTVERIFY_BATCH_SIZE=25
```

Backblaze B2 via rclone:

```text
B2_REMOTE=b2:your-bucket/outreach-crm/
```

Before a production import or deploy sanity check:

```bash
npm run prod:check
```

## Pages

### `/dashboard`

Shows:

- replies needing action
- follow-ups due
- overdue follow-ups
- sent/no-reply threads
- send anomalies
- recently imported mail

Dashboard action lists exclude dead, bounced, skipped, blocked, do-not-resend, and known non-actionable platform records. WordPress.org notification emails are also filtered from reply-action counts.

### `/targets`

Shows all targets with search, filters, pagination, source, dedupe key, status, and send action.

Behavior:

- Sorted by latest activity, including message time.
- Paginated at 50 targets per page.
- Send button is disabled for no-email, dead, bounced, skipped, blocked, do-not-resend, non-actionable platform targets, and blocking email-verification statuses.
- Export links preserve the active target filters.

### `/targets/[id]`

Target detail page shows:

- contact/company/source fields
- target status and do-not-resend state
- message thread
- timeline events
- contact-form submissions
- notes
- follow-up creation and existing follow-ups

Message behavior:

- Messages sort by actual mail time, newest first.
- Unread inbound messages are highlighted.
- Inbound messages are marked read when the target page is loaded.

Do-not-resend behavior:

- `Do not resend` marks the target dead and cancels open follow-ups.
- `Allow resend` clears the do-not-resend flag but does not blindly invent a new status.

### `/followups`

Manual follow-up queue with filters:

- due today
- overdue
- upcoming
- all open

Behavior:

- Shows total count: `Showing X-Y of N follow-ups`.
- Paginated at 50 follow-ups per page.
- Send, complete, snooze, and dead actions are available per row.
- Pagination and filter state are preserved when opening/closing the send modal.
- Dead action closes/cancels open follow-up work for that target.

### `/import`

CSV import with preview and dedupe protection.

Supported canonical outreach fields include:

```text
target
contact_type
contact_value
domain_key
dedupe_key
subject_or_form_context
message_text_or_summary
follow_up_date
next_action
do_not_resend
source_reference
```

Import behavior:

- Respects provided `dedupe_key`.
- Maps email/form/thread/url-style contact types.
- Rejects unsupported tracker CSVs like platform-status style imports.
- Treats canonical `do_not_resend` as dedupe-only protection unless the row also has a hard-dead signal.
- Creates `followup_tasks` only when the imported row is actually actionable.
- Skips automatic follow-ups for contact forms, monitor-only rows, already-followed-up rows, and conditional wait-only rows.
- Preserves source timestamps from fields like `date_sent`, `date_posted`, `date_updated`, `date_recorded`, or embedded date text.
- Contact form rows create `contact_form_submissions` for dedupe/history.

### `/analytics`

Shows:

- total targets
- touched targets
- replied targets
- open follow-ups
- source performance
- recent events
- daily activity chart

Daily chart ranges:

- 7 days
- 2 weeks
- this month
- last month
- last 30 days

Daily activity chart separates:

- `New outreach` in blue
- `Replies` in green
- `Bounced` in red
- `Follow-ups` in amber

Follow-up sends are not counted as blue new outreach anymore. If a send has a matching `followup_sent` event, it is counted as follow-up activity. Later outbound sends for already-touched targets are also treated as follow-ups.

The top `Outreached` metric and Source Performance `Outreached` column count real outbound evidence from synced mail threads, live `email_sent` events, and imported `outreach_logged` events. Imported `contact_form` rows are not treated as sent email unless a real outbound email exists for that target.

### `/settings/modules`

Shows module state based on environment flags. Includes Telegram test send. The Telegram test sends a real message and includes the ReachLog link.

## Send Modal

The send modal is used from dashboard, targets, target detail, and follow-ups.

Current behavior:

- Scrolls correctly on small screens.
- Shows `Sending...` while the server action is running.
- Requires subject and body.
- Shows visible success/info/error feedback after server action redirects.
- Explains why send is disabled before clicking.
- Blocks duplicate double-submit with `send_key`.
- Does not crash the UI on SMTP failure.
- Records send failures and send anomalies.
- Splits SMTP accept from DB persistence failure. If SMTP accepted the email but the DB write failed, it records `smtp_accepted_persist_failed` and warns not to resend blindly.

Sender behavior:

- `From` dropdown is populated from `SMTP_FROM_IDENTITIES`.
- The latest outbound sender for the target is preselected.
- If there is no previous outbound sender, the app tries to infer sender from target/source/domain text.
- Otherwise it falls back to the first configured sender identity.
- Message-ID domain follows the selected sender domain.

Body/follow-up behavior:

- The modal defaults to the latest outbound body stored for that target.
- New targets with no prior outbound message start with a blank body.
- `Create next follow-up` defaults to 5 days.
- Follow-up tasks created after sending use the actual body just sent as `suggested_body`.

## Mail Sync

`worker:mail-sync` imports from Proton Bridge IMAP.

Normal sync uses mailbox cursors and only imports new UIDs after the first run. For a one-off historical pass, use:

```bash
MAIL_SYNC_RESYNC_DAYS=30 npm run worker:mail-resync
```

That command searches the configured IMAP mailboxes inside the lookback window and tries to attach missing messages again. Already-imported messages are skipped by unique `messages.message_id`. This is useful when targets were imported after the IMAP cursor had already scanned older mail, or when `IMAP_LOOKBACK_DAYS` was too small on the first sync.

CSV import requests an automatic one-time mail resync when it inserts email targets. The next scheduled `worker:mail-sync` consumes that request and searches the last `IMAP_AUTO_RESYNC_DAYS` days, so new CSV imports can attach existing Proton Sent/INBOX messages without manually running resync.

Audit mail coverage with:

```bash
npm run prod:mail-sync-audit
```

The audit prints cursor state, imported message counts by mailbox, email targets with zero imported messages, and unlinked mail events that now match known contact emails.

Threading behavior:

- Uses `Message-ID`, `In-Reply-To`, and `References` first.
- Falls back to exact participant email.
- Falls back to domain matching for non-free-mail domains.
- Uses normalized subject as a fallback.
- Repeated `Re:` / `Fwd:` prefixes are normalized.
- Existing messages are skipped by unique `messages.message_id`.
- Thread state is computed by actual message timestamps, not import order.
- Message display uses actual sent/received timestamp, not import time.

Status behavior:

- Inbound human reply sets thread/target as replied and cancels open follow-ups.
- Outbound sync preserves meaningful imported statuses instead of overwriting everything as `sent`.
- Bounces/delivery failures are classified separately and mark target status as `bounced_dead_address`.
- WordPress.org thread notifications and similar non-actionable notifications are stored but do not trigger "reply needing action".

Telegram reply notifications:

- Sent only for actionable inbound replies.
- Include sender, subject, cleaned current-reply text, and target link.
- The reply snippet strips common quoted-history blocks like `On ... wrote:`, `-----Original Message-----`, `From:/Sent:/To:/Subject:`, quote lines, and signatures.
- Full email body is still stored in ReachLog.

## SMTP Sending

`sendNowAction` sends through Proton Bridge SMTP with Nodemailer.

Safety behavior:

- Blocks no-email targets.
- Blocks do-not-resend targets.
- Blocks dead/bounced/skipped/blocked/do-not-send statuses.
- Blocks known non-actionable platform targets like `platform:contra` and `platform:codementor`.
- Blocks EmailListVerify statuses considered unsafe.
- Uses an idempotency key to prevent double-click duplicate sends.
- Stores outgoing messages in `messages`.
- Updates `threads`, `outbound_sends`, `followup_tasks`, and `events`.
- Sends `In-Reply-To` and `References` when replying inside an existing thread.

## Email Verification

EmailListVerify is optional and controlled by:

```text
EMAILLISTVERIFY_ENABLED=true
EMAILLISTVERIFY_API_KEY=
```

Behavior:

- New email contacts can be checked once in the background.
- Recheck is manual through the target UI.
- Verification status is stored on the contact.
- Blocking statuses disable send actions.

Worker:

```bash
npm run worker:email-verify
```

## Telegram

Telegram is event-driven:

- follow-up due
- reply received
- worker failure
- backup failure
- test notification

Notifications include ReachLog links where useful.

Due follow-ups are stamped after notification so the same overdue task does not repeatedly notify.

## Exports

Export URLs support `format=csv` or `format=json`:

- `/api/export/targets`
- `/api/export/messages`
- `/api/export/followups`
- `/api/export/events`
- `/api/export/contact-forms`
- `/api/export/outbound-sends`

Examples:

```text
/api/export/targets?format=csv
/api/export/messages?format=json
/api/export/followups?filter=due&format=csv
```

Targets export accepts:

```text
q
status
source
domain
flag
```

Follow-up export accepts:

```text
filter=due
filter=overdue
filter=upcoming
filter=all
```

## Database

Core tables:

- `contacts`
- `targets`
- `threads`
- `messages`
- `followup_tasks`
- `contact_form_submissions`
- `events`
- `outbound_sends`
- `jobs`
- `module_settings`
- `worker_locks`
- `mailbox_cursors`

Important unique indexes:

- `contacts.email`
- `targets.dedupe_key`
- `messages.message_id`
- `contact_form_submissions.dedupe_key`
- `outbound_sends.message_id`
- `outbound_sends.send_key`

The database bootstraps on first app or worker run. Drizzle schema lives in:

```text
src/modules/core/db/schema.ts
```

## Workers

Run these from Forge scheduled jobs, cron, or systemd timers:

```bash
npm run worker:mail-sync
npm run worker:mail-resync
npm run worker:followup-check
npm run worker:email-verify
npm run worker:backup
```

Suggested schedule:

```text
mail-sync        every 1-5 minutes
followup-check   every 15 minutes
email-verify     every 5-15 minutes when enabled
backup           daily
```

Worker locks are stored in SQLite so overlapping timers do not run the same job twice.

List Proton Bridge mailboxes before enabling sync:

```bash
npm run worker:list-mailboxes
```

## Backup And Restore

Backup worker uses SQLite `VACUUM INTO`, gzips the result, and optionally copies backups to B2 with `rclone`.

Manual backup:

```bash
npm run worker:backup
```

Restore test pattern:

```bash
gunzip -c /home/reach-log/reachlog-pzjckw1w.on-forge.com/shared/data/backups/app-YYYY-MM-DD.sqlite.gz > /tmp/reachlog-restore.sqlite
DATABASE_PATH=/tmp/reachlog-restore.sqlite npm run worker:followup-check
```

Do not copy a live SQLite database with plain `cp` while the app may be writing.

## Production Maintenance Scripts

```bash
npm run prod:check
npm run prod:backfill-source-timestamps
npm run prod:backfill-mail-event-timestamps
```

`prod:check` verifies key production paths, dependencies, env safety, and module config.

`prod:backfill-source-timestamps` repairs imported outreach/form event dates from historical CSV payload data.

`prod:backfill-mail-event-timestamps` repairs already-imported mail events by matching event `messageId` to the `messages` table, so analytics use actual email timestamps instead of sync time.

## Deployment Shape

Build and run:

```bash
npm run build
npm run start
```

The app should bind behind the Forge/Nginx reverse proxy. The intended shape:

```text
HTTPS reverse proxy -> Next.js app on localhost -> SQLite shared/data file
                         |
                         -> worker scripts via Forge scheduled jobs
                         -> Proton Bridge IMAP/SMTP on same VDS/private network
                         -> optional Telegram
                         -> optional EmailListVerify
                         -> optional rclone B2 backups
```

Production examples:

```text
docs/production.md
deploy/caddy/Caddyfile.example
deploy/systemd/
```

Do not run app scripts with `sudo`. Run as the site user, `reach-log`, so SQLite files remain writable by the app.

## Current Non-Goals

- No multi-user/team permission system.
- No Better Auth/OAuth/registration/password reset.
- No Redis/BullMQ/RabbitMQ.
- No automatic mass follow-up sender.
- No contracts/invoices inside outreach tables.
- No marketplace/WP.org/platform tracker import modes yet, beyond safe rejection/non-actionable handling.

## Later

- Dedicated import modes for marketplace bids, WP.org threads, and platform statuses.
- Contact form submission creation from the UI.
- Mailbox connection test buttons.
- PostgreSQL only if multiple workers/team usage/heavier analytics become real.
- Contracts/invoices as separate modules after a target becomes a client.
