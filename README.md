# ReachLog

**Self-hosted AI automation for managing business conversations.** ReachLog
triages replies, drafts the next follow-up, captures inbound leads, and updates
your pipeline when the evidence is strong. Review suggestions in one place and
choose how much to automate.

Bring your own OpenAI-compatible provider, including a local model server.
ReachLog runs on your machine, opens in your browser, and stores its data in
SQLite. It is free, open source, and built for one person. AI and automatic
sending are optional and off by default.

- **Reply triage:** identify intent, requests, and commitments with supporting quotes.
- **Follow-up drafting:** prepare the next step using recent conversation history.
- **Inbound lead capture:** turn unmatched business mail into contacts and targets.
- **Human review:** inspect uncertain suggestions before applying them.

![AI review with inbound leads, follow-up drafts, and reply assessments using sample data](https://cdn.jsdelivr.net/npm/reachlog@1.0.0/docs/images/ai-review.png)

## Try the demo

```sh
npx reachlog demo
```

Requires **Node.js 22 or 24** and npm. Open <http://127.0.0.1:3000> to explore
sample accounts, contacts, replies and follow-ups. The demo is read-only and uses
its own database. Editing, sending, mailbox sync and notifications are disabled.

The SQLite dependency may need a C++ build toolchain if a prebuilt binary is not
available for your platform.

## Start using ReachLog

```sh
npx reachlog
```

Open <http://127.0.0.1:3000>. The app starts empty. Add your contacts and targets
or import a CSV, then configure AI automation below.

For a persistent installation:

```sh
npm install --global reachlog
reachlog
```

ReachLog prints the address to open and where its database lives. Press Ctrl+C to
stop it. If a port is already busy it says so and suggests another one instead of
failing with a stack trace.

## AI automation

ReachLog can automate three jobs without tying you to one vendor:

- **Reply triage** reads the latest inbound message, extracts the ask and any commitment, suggests a pipeline stage with quoted evidence, and saves a reply draft or schedules a follow-up.
- **Follow-up autopilot** writes the next email using recent thread history. It can stop at a reviewable draft, or send inside an existing thread within a daily cap.
- **Inbound lead capture** classifies mail that did not match a target, extracts the company and need, and either creates a target or puts the lead in **AI review**.

1. Open **Settings → Connections → AI automation**. Set an OpenAI-compatible
   base URL (including `/v1` where required), API key, and exact model name, then
   test and enable the connection. Local providers can leave the key blank.
2. Connect IMAP and enable **Mailbox sync** under **Settings → Background tasks**
   to bring in new replies and unmatched mail.
3. Enable **AI automation** under **Settings → Background tasks**. Start with
   drafts and review suggestions on the **AI review** page.

The provider must support chat completions and return the requested JSON.
You can configure a hosted endpoint or a local server such as Ollama or LM Studio
with a compatible model. Provider and model capabilities vary; use the connection
test before enabling automation.

AI runs in the background every five minutes by default while ReachLog is
running. It never auto-marks a target Won or overwrites a stage you changed
manually in the previous seven days. Suggestions that need a decision go to
**AI review**. High-confidence explicit opt-outs block sending.

Auto-send is off by default. When enabled, it applies only to a follow-up inside an existing thread, only when no newer reply exists, only within the daily limit, and only while the target passes the normal do-not-contact, bounce, and email-verification guards. Cold outreach is never sent automatically.

Email content used for triage, drafting, or lead extraction is sent to your
configured provider. A hosted provider receives that content; a local endpoint
can keep processing on your machine. API keys saved through Settings are stored
in `connections.json` with owner-only permissions and are not returned to the browser.

For external scheduling, run the AI worker once with `reachlog worker ai`.

## When ReachLog is useful

Use ReachLog when keeping up with business conversations means repeatedly
reading replies, deciding what happens next, and copying leads into a tracker.
AI automation handles those routine steps alongside accounts, contacts,
conversation history, and follow-ups. You can also manage everything manually
with AI disabled.

![A sample conversation with an AI assessment, supporting quotes, and a suggested pipeline stage](https://cdn.jsdelivr.net/npm/reachlog@1.0.0/docs/images/ai-assessment.png)

## Accounts, contacts and the pipeline

Open **Pipeline** to see your targets grouped by stage. Move a card when its
stage changes; enabled AI triage can also advance it after a reply. Moving a card updates the outreach status, records the change on the
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

- Automate reply triage, follow-up drafting, and inbound lead capture with your chosen AI provider.
- Review AI suggestions, supporting quotes, and drafts before applying uncertain decisions.
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

Optional auto-send is limited to follow-ups in existing threads. ReachLog has no
bulk campaign sender, team accounts, hosted service, or registration flow.

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
reachlog worker ai
reachlog worker followup-check
reachlog worker backup
```

Open **Settings → Background tasks** to enable schedules, choose intervals, run a task now, and check the last run, last success, next run, or failure. New schedules start paused; upgrades preserve your existing settings. They run only while ReachLog is running. An overdue task runs once after restart; missed intervals are not replayed. Follow-up reminders do not send email; AI autopilot can, only when explicitly enabled.

For an existing cron or systemd setup, start with `reachlog --no-scheduler` or `REACHLOG_SCHEDULER_ENABLED=false`. One-shot worker commands remain available and share worker locks with built-in scheduling.

## Email templates

Open **Templates** to create, edit, or delete a reusable subject and body. Supported variables are `{{contact_name}}`, `{{company}}`, `{{email}}`, and `{{website}}`.

In the email composer, choose a template to preview it for the current contact. **Use template** replaces the subject and body; **Undo template** restores the previous text. Edit the result before sending. Missing values remain visible and block sending until replaced; unfinished messages can still be saved as drafts. Deleting a template does not change saved drafts or sent messages.

## Network access

The default listener is `127.0.0.1`. To use a network address, configure Basic Auth first. For internet access, place ReachLog behind an HTTPS reverse proxy and keep the application listener on localhost.

Keep your real contact database private. The optional public demo uses separate
sample data and blocks changes.

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
