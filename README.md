# ReachLog

ReachLog is a private outreach command center:

```text
targets -> outreach events -> email threads -> follow-up tasks -> dedupe protection -> analytics
```

It is intentionally a modular monolith, not a generic CRM and not a microservice system.

## Stack

- Next.js App Router
- TypeScript
- React
- Tailwind CSS
- Drizzle ORM
- SQLite first
- Node worker scripts
- Proton Bridge-compatible IMAP/SMTP settings

## Quick Start

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

The app creates a local SQLite database automatically at:

```text
.data/app.sqlite
```

For production, set:

```text
DATABASE_PATH=/data/outreach-crm/app.sqlite
BACKUP_DIR=/data/outreach-crm/backups
```

## Environment

Copy the example file and edit the values you need:

```bash
cp .env.example .env.local
```

For Forge/VDS production values, start from `.env.production.example`.

Important flags:

```text
TZ=Asia/Bangkok
SEED_DEMO_DATA=false
SMTP_ENABLED=false
SMTP_SECURE=false
IMAP_ENABLED=false
IMAP_SECURE=false
IMAP_MAILBOXES=INBOX,Sent
IMAP_LOOKBACK_DAYS=90
TELEGRAM_ENABLED=false
```

The app assumes a single owner user. For production, enable the built-in Basic
Auth gate:

```text
APP_BASIC_AUTH_ENABLED=true
APP_BASIC_AUTH_USER=owner
APP_BASIC_AUTH_PASSWORD=use-a-long-random-password
```

You can still put Cloudflare Access, Forge Nginx auth, or Caddy `basic_auth` in
front as an extra gate.

Before a production import, run:

```bash
npm run prod:check
```

## Pages

- `/dashboard` shows replies needing action, follow-ups due, sent/no-reply counts, and recent mail.
- `/targets` lists, searches, filters, and creates outreach targets with status, source, and dedupe keys.
- `/targets/[id]` edits target/contact fields and shows timeline, thread, contact forms, notes, and follow-up state.
- `/followups` is the manual follow-up queue with due/overdue/upcoming filters and completion actions.
- `/import` is the CSV intake and dedupe preview surface. It supports the canonical outreach columns: `target`, `contact_type`, `contact_value`, `domain_key`, `dedupe_key`, `subject_or_form_context`, `message_text_or_summary`, `follow_up_date`, `next_action`, and `do_not_resend`. Imported `do_not_resend` is treated as dedupe protection unless the row status/action is explicitly dead, bounced, skipped, blocked, or do-not-send.
- `/analytics` summarizes funnel metrics, source performance, recent events, and event/source/status counts.
- `/settings/modules` shows runtime module state from environment flags.

## Exports

Export URLs support `format=csv` or `format=json`:

- `/api/export/targets`
- `/api/export/messages`
- `/api/export/followups`
- `/api/export/events`
- `/api/export/contact-forms`
- `/api/export/outbound-sends`

The targets export accepts the same filters as `/targets`: `q`, `status`,
`source`, `domain`, and `flag`. Follow-up export accepts `filter=due`,
`overdue`, `upcoming`, or `all`.

## Database

The core tables are:

- `contacts`
- `targets`
- `threads`
- `messages`
- `followup_tasks`
- `contact_form_submissions`
- `events`
- `jobs`
- `module_settings`

Unique indexes protect the important dedupe surfaces:

- `contacts.email`
- `targets.dedupe_key`
- `messages.message_id`
- `contact_form_submissions.dedupe_key`

The database is bootstrapped on first app or worker run. Drizzle schema lives in:

```text
src/modules/core/db/schema.ts
```

## Workers

Run these from cron or systemd timers:

```bash
npm run worker:mail-sync
npm run worker:followup-check
npm run worker:backup
```

Suggested schedule:

```text
mail-sync        every 1 minute
followup-check   every 15 minutes
backup           daily
```

`worker:mail-sync` connects to IMAP when `IMAP_ENABLED=true`. It imports unseen messages, links them to existing threads by `Message-ID`, `In-Reply-To`, and `References` first, falls back to known contact email/domain plus normalized subject, sends Telegram notifications for inbound replies, and records unlinked messages as mailbox events.

`worker:followup-check` finds due follow-ups and sends Telegram notifications when Telegram is enabled. It stamps notification fields so the same overdue task does not keep spamming.

`worker:backup` uses SQLite `VACUUM INTO`, gzips the snapshot, and optionally copies the backup directory with `rclone` when `B2_REMOTE` is set.

Workers use SQLite-backed leases so timer overlap does not run the same job twice
at the same time. Mail sync stores per-mailbox IMAP UID cursors in SQLite.

## Proton Bridge

Use Proton Bridge on the same VDS or private network as the app and point the env vars at Bridge's local IMAP/SMTP ports:

```text
IMAP_HOST=127.0.0.1
IMAP_PORT=1143
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
```

Exact ports depend on your Bridge configuration.

List Bridge mailbox names before enabling sync:

```bash
npm run worker:list-mailboxes
```

## Deployment Shape

Build and run:

```bash
npm run build
npm run start
```

Put Caddy, Cloudflare Tunnel, or another reverse proxy in front of the app. For a Caddy-protected single-user deployment, the shape is:

```text
HTTPS reverse proxy -> Next.js app -> SQLite file
                         |
                         -> worker scripts via cron/systemd
                         -> Proton Bridge IMAP/SMTP
```

Production examples live in:

```text
docs/production.md
deploy/caddy/Caddyfile.example
deploy/systemd/
```

## Roadmap

Near-term:

- Contact form submission creation from the UI.
- Mailbox settings validation from the UI.
- Export views for targets, messages, and follow-ups.

Later:

- Jobs table processing if worker needs grow.
- PostgreSQL migration if multiple workers or team usage becomes real.
- Contracts and invoices as separate modules after a target becomes a client.
