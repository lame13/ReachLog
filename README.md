# ReachLog

Keep track of who you contacted, what you sent, who replied and when to follow
up — and where each company stands, from first contact to a signed job.

ReachLog is a self-hosted app for one person. It runs on your machine, opens in
your browser and stores its data in SQLite. You can use it without connecting an
email account. Accounts, contacts and a pipeline keep the people and companies
behind your outreach together.

![The targets list, with status and source filters](https://raw.githubusercontent.com/lame13/ReachLog/master/docs/images/targets.png)

## Try the demo

```sh
npx reachlog demo
```

Requires **Node.js 22 or 24** and npm. Open <http://127.0.0.1:3000> to explore
sample accounts, contacts, replies and follow-ups. The demo is read-only and uses
its own database. Editing, sending, mailbox sync and notifications are disabled.

The SQLite dependency may need a C++ build toolchain if a prebuilt binary is not
available for your platform.

## Publish the demo

You can also host the sample data as a public, read-only demo. Visitors can
browse and export it, but cannot save changes, import data or send messages.
Mailbox sync, Telegram and email verification stay off.

After installing ReachLog globally, run it behind an HTTPS reverse proxy:

```sh
REACHLOG_DEMO_PUBLIC=true APP_URL=https://reachlog-demo.example.com \
  reachlog demo --host 127.0.0.1 --port 3001 --data-dir /var/lib/reachlog-demo
```

`REACHLOG_DEMO_PUBLIC=true` is what allows the app to answer a public address
without basic auth. Without it, a non-local address still requires
`APP_BASIC_AUTH_*`, exactly as it does for a private installation. Keep the
process on the loopback address. The package includes example configuration:
`deploy/systemd/reachlog-demo.service`, `deploy/reachlog-demo.env.example`,
`deploy/caddy/demo.Caddyfile.example` and `deploy/nginx/reachlog-demo.conf`.
The systemd example assumes a source checkout built with
`npm ci && npm run build` in `/opt/reachlog`, a `reachlog` system user and a
configuration file at `/etc/reachlog-demo.env`.

## Start tracking your outreach

```sh
npx reachlog
```

Open <http://127.0.0.1:3000>. Add a target or import a CSV. The app starts empty; email and notifications are off by default.

For a persistent installation:

```sh
npm install --global reachlog
reachlog
```

ReachLog prints the address to open and where its database lives. Press Ctrl+C to
stop it. If a port is already busy it says so and suggests another one instead of
failing with a stack trace.

## When ReachLog is useful

If your outreach spreadsheet is getting hard to keep up with, ReachLog brings
contacts, conversation history and follow-ups into one place. Each target can
include the post or website where you found it. Connect email when you want
replies and sent messages to appear automatically, or keep recording outreach
by hand.

ReachLog is free, open source and built for one person managing their own outreach.

![Analytics by source, with daily outreach, replies and follow-ups](https://raw.githubusercontent.com/lame13/ReachLog/master/docs/images/analytics.png)

## Accounts, contacts and the pipeline

Open **Pipeline** to see your targets grouped by stage. Move a card when its
stage changes; mail sync does not move it for you. Moving a card updates the outreach status, records the change on the
timeline, and cancels open follow-ups when you close something as Lost. **New
target** and the CSV import put companies on the board for you.

Open **Accounts** for the companies behind your outreach, and **Contacts** for
the people. An account page collects its contacts, its targets, its mail and its
own notes; a contact page collects the person's details, tags, links and
history. Accounts are created automatically when a target names a company, and
targets with the same company domain share one account. Without a domain,
ReachLog matches the company name.

Stages are a fixed set, so they can be counted in Analytics and used as filters.
The free-text status that ReachLog has always had is still there for anything
the stages do not cover.

## What it does

- Track companies as **accounts**, with the contacts, targets and notes that belong to each one.
- Track people as **contacts**, with a title, phone, tags, links and their own history.
- Move each target through a **pipeline**: New, Contacted, Replied, In conversation, Qualified, Won or Lost.
- Track outreach history and do-not-contact records.
- Import CSV files with a duplicate check before changes are made.
- Save email drafts and schedule manual follow-ups.
- Reuse email templates with contact variables, previews, and editable messages.
- Configure and test SMTP, IMAP, and Telegram in Settings. Discover available mailboxes and use local Proton Bridge presets.
- Schedule mailbox sync, follow-up reminders, and database backups while the app is running.
- Connect SMTP for individual sends and IMAP for replies and sent messages. Proton Bridge is supported.
- Export accounts, targets, contacts, messages, follow-ups and history as CSV or JSON.
- Search company names, contacts, message text and contact form submissions from the header.
- Optionally verify addresses with EmailListVerify and receive Telegram notifications.
- Back up SQLite without stopping the app.

ReachLog does not send campaigns automatically. It has no team accounts, hosted service or registration flow.

## Your data

By default, the CLI stores your database in `~/.reachlog/app.sqlite` and backups in `~/.reachlog/backups/`. Updating or reinstalling the npm package does not move or delete them.

Backups are compressed SQLite snapshots. Check one before restoring it with `reachlog verify-backup <file>`, which reports the integrity check, schema version and record counts without touching your live data.

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

Open **Settings → Background tasks** to enable schedules, choose intervals, run a task now, and check the last run, last success, next run, or failure. New schedules start paused; upgrades preserve your existing settings. They run only while ReachLog is running. An overdue task runs once after restart; missed intervals are not replayed. Follow-up notifications do not send follow-up emails.

For an existing cron or systemd setup, start with `reachlog --no-scheduler` or `REACHLOG_SCHEDULER_ENABLED=false`. One-shot worker commands remain available and share worker locks with built-in scheduling.

## Email templates

Open **Templates** to create, edit, or delete a reusable subject and body. Supported variables are `{{contact_name}}`, `{{company}}`, `{{email}}`, and `{{website}}`.

In the email composer, choose a template to preview it for the current contact. **Use template** replaces the subject and body; **Undo template** restores the previous text. Edit the result before sending. Missing values remain visible and block sending until replaced; unfinished messages can still be saved as drafts. Deleting a template does not change saved drafts or sent messages.

## Network access

The default listener is `127.0.0.1`. To use a network address, configure Basic Auth first. For internet access, place ReachLog behind an HTTPS reverse proxy and keep the application listener on localhost.

Keep your real contact database private. The optional public demo uses separate
sample data and blocks changes.

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

## Feedback and support

Found a bug or got stuck setting it up? [Open an issue](https://github.com/lame13/ReachLog/issues)
with what you were doing, your Node.js version and your operating system. Include
the error screen's technical details and any relevant terminal output, with
passwords and personal data removed. See [CHANGELOG.md](CHANGELOG.md) for changes
and upgrade notes.

## License

MIT. Built by [Niko](https://nikocodes.com/software/reachlog/).
