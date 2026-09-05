# ReachLog 0.2.0

This release adds background scheduling, guided connection setup, and reusable email templates. See [CHANGELOG.md](CHANGELOG.md) for the full change list.

## Start using the new features

1. Open **Settings → Connections**. Save SMTP, IMAP, or Telegram details and test the connection. Enable the features you want to use. IMAP can discover available mailboxes; Proton Bridge presets fill in local connection defaults.
2. Open **Settings → Background tasks**. Enable mailbox sync, follow-up reminders, or database backups and choose their intervals. Schedules run only while ReachLog is running. The page shows their latest run, last success, next run, and any failure.
3. Open **Templates**. Save a subject and message with `{{contact_name}}`, `{{company}}`, `{{email}}`, or `{{website}}`. Preview and apply a template in the composer, then edit the message before sending. Missing variables block sending but can remain in saved drafts.

## Upgrading from 0.1.0

- Keep the existing data directory and back up the database before upgrading. Migration 0007 preserves existing records and adds templates and schedule state.
- All built-in schedules start paused. Existing cron and systemd jobs remain supported; use `--no-scheduler` or `REACHLOG_SCHEDULER_ENABLED=false` when retaining those jobs.
- Environment and `.env` values still take precedence. Those fields appear read-only in the UI. Remove a connection's environment values and restart to manage it in Settings instead.
- Saved connection credentials live in `connections.json` outside the package installation. They use owner-only POSIX file permissions and are never returned in browser responses. They are not part of SQLite backups, so protect and back up that file separately.
- Node.js 22 or 24 is required. This release keeps the existing locked dependency versions.

Connection verification does not send email or Telegram notifications. The separate **Send test notification** action sends a message to the configured chat. SMTP verification checks the connection and login; sender acceptance is determined when an email is sent.

## Verification

- Node.js 24.20.0: type checking, lint, all 17 test cases, production build, and package inspection passed.
- A fresh tarball installation passed HTTP checks for persistence, exports, backups, isolated demo data, and authentication.
- Chrome passed template editing, client and server validation, connection setup and verification, scheduled backups, restart persistence, manual sending to a local SMTP fixture, and desktop/mobile layout checks. Screenshots were inspected; no browser errors remained.
- The development launcher and packaged scheduler opt-out passed startup, configuration, scheduler-state, and shutdown checks. SMTP/IMAP use local fixtures and Telegram uses mocked responses; live provider accounts were not contacted.

The repository remains private. No npm publication or public GitHub release is part of this update.
