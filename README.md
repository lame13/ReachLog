# ReachLog

Keep track of who you contacted, what you sent, who replied and when to follow up.

ReachLog is a self-hosted app for one person. It runs on your machine, opens in your browser and stores its data in SQLite. You can use it without connecting an email account.

## Start

Requires **Node.js 22 or 24** and npm. The SQLite dependency may need a C++ build toolchain on platforms without a prebuilt binary.

After publication:

```sh
npx reachlog
```

Open <http://127.0.0.1:3000>. Add a target or import a CSV. The app starts empty; email and notifications are off by default.

For a persistent installation:

```sh
npm install --global reachlog
reachlog
```

Try sample data:

```sh
reachlog demo
```

Demo uses a separate database. It records simulated sends locally and never connects to email or notification services.

## What it does

- Track contacts, companies, outreach history and do-not-contact records.
- Import CSV files with a duplicate check before changes are made.
- Save email drafts and schedule manual follow-ups.
- Reuse email templates with contact variables, previews, and editable messages.
- Configure and test SMTP, IMAP, and Telegram in Settings. Discover available mailboxes and use local Proton Bridge presets.
- Schedule mailbox sync, follow-up reminders, and database backups while the app is running.
- Connect SMTP for individual sends and IMAP for replies and sent messages. Proton Bridge is supported.
- Export contacts, messages, follow-ups and history as CSV or JSON.
- Optionally verify addresses with EmailListVerify and receive Telegram notifications.
- Back up SQLite without stopping the app.

ReachLog does not send campaigns automatically. It has no team accounts, hosted service or registration flow.

## Your data

By default, the CLI stores your database in `~/.reachlog/app.sqlite` and backups in `~/.reachlog/backups/`. Updating or reinstalling the npm package does not move or delete them.

Choose a different location or port:

```sh
reachlog --data-dir /path/to/reachlog-data --port 3100
```

On Windows, use a Windows path, for example `reachlog --data-dir C:\ReachLog`.

The CLI reads `<data-dir>/.env` if present. Use `--env-file /path/to/settings.env` to select another file. Shell environment variables take precedence. Relative database and backup paths are resolved from the data directory.

Use the same data directory and configuration for the app and its workers.

## Email and notifications

Open **Settings → Connections**. Enter account details, save, and test the connection. Enable sending, mailbox sync, or Telegram when ready. SMTP and IMAP tests do not send email; Telegram connection tests check the bot and chat without sending a notification. A separate **Send test notification** button sends a message to your configured chat.

Settings take effect immediately. Password fields stay blank after saving; leaving one blank preserves its saved value. Explicit environment and `.env` values take precedence and appear as read-only fields. Keep those values unset to manage a connection through the UI. [examples/reachlog.env.example](examples/reachlog.env.example) documents the optional environment settings.

[Configuration and hosting](docs/configuration.md) covers SMTP, Proton Bridge, IMAP, authentication, scheduled jobs and backups.

Run a worker once:

```sh
reachlog worker mail-sync
reachlog worker followup-check
reachlog worker backup
```

Open **Settings → Background tasks** to enable schedules, choose intervals, run a task now, and check the last run, last success, next run, or failure. Schedules start paused, including after an upgrade. They run only while ReachLog is running. An overdue task runs once after restart; missed intervals are not replayed. Follow-up notifications do not send follow-up emails.

For an existing cron or systemd setup, start with `reachlog --no-scheduler` or `REACHLOG_SCHEDULER_ENABLED=false`. One-shot worker commands remain available and share worker locks with built-in scheduling.

## Email templates

Open **Templates** to create, edit, or delete a reusable subject and body. Supported variables are `{{contact_name}}`, `{{company}}`, `{{email}}`, and `{{website}}`.

In the email composer, choose a template to preview it for the current contact. **Use template** replaces the subject and body; **Undo template** restores the previous text. Edit the result before sending. Missing values remain visible and block sending until replaced; unfinished messages can still be saved as drafts. Deleting a template does not change saved drafts or sent messages.

## Network access

The default listener is `127.0.0.1`. To use a network address, configure Basic Auth first. For internet access, place ReachLog behind an HTTPS reverse proxy and keep the application listener on localhost.

This remains a single-owner application. Do not expose a demo or your contact database as a public website.

## From source

```sh
npm ci
npm run dev
```

Source development uses `.data/app.sqlite` in the checkout unless `DATABASE_PATH` is set. For sample data, use `npm run demo:dev`.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

`npm start` uses the packaged CLI and its persistent data directory. [Development and release notes](docs/development.md) explain packaging and verification.

## License

MIT. Built by [Niko](https://nikom.work/).
