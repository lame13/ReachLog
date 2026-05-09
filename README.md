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

Important flags:

```text
SMTP_ENABLED=false
IMAP_ENABLED=false
TELEGRAM_ENABLED=false
```

The app assumes a single owner user. Put Cloudflare Access or Caddy `basic_auth` in front of it instead of building app-level auth now.

## Pages

- `/dashboard` shows replies needing action, follow-ups due, sent/no-reply counts, and recent mail.
- `/targets` lists outreach targets with status, source, and dedupe keys.
- `/targets/[id]` shows the target timeline, thread, contact forms, and follow-up state.
- `/followups` is the manual follow-up queue.
- `/import` is the CSV intake and dedupe preview surface.
- `/analytics` summarizes event, source, and status counts.
- `/settings/modules` toggles module settings stored in SQLite.

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

`worker:mail-sync` connects to IMAP when `IMAP_ENABLED=true`. It imports unseen messages, links them to existing threads by `Message-ID`, `In-Reply-To`, and `References` first, falls back to known contact email plus normalized subject, and records unlinked messages as mailbox events.

`worker:followup-check` finds due follow-ups and sends Telegram notifications when Telegram is enabled. It stamps notification fields so the same overdue task does not keep spamming.

`worker:backup` uses SQLite `VACUUM INTO`, gzips the snapshot, and optionally copies the backup directory with `rclone` when `B2_REMOTE` is set.

## Proton Bridge

Use Proton Bridge on the same VDS or private network as the app and point the env vars at Bridge's local IMAP/SMTP ports:

```text
IMAP_HOST=127.0.0.1
IMAP_PORT=1143
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
```

Exact ports depend on your Bridge configuration.

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

## Roadmap

Near-term:

- Better analytics from the `events` table.
- Target creation/edit forms outside CSV import.
- Manual follow-up creation and completion outside the send flow.
- Search wiring in the app shell.

Later:

- Jobs table processing if worker needs grow.
- PostgreSQL migration if multiple workers or team usage becomes real.
- Contracts and invoices as separate modules after a target becomes a client.
