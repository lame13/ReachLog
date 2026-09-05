# Changelog

## 0.2.0 — 2026-09-06

### Added

- Built-in scheduling for mailbox sync, Telegram follow-up reminders, and SQLite backups, with opt-in schedules, editable intervals, Run now, and visible last-run, last-success, next-run, and failure states.
- Guided SMTP, IMAP, and Telegram setup in Settings, with immediate configuration updates, private credential storage, connection tests, mailbox discovery, and local Proton Bridge presets.
- Email template management with contact variables, previews, editable populated messages, and undo when replacing a composer draft.
- Regression coverage for upgrades, credential handling, local SMTP/IMAP protocols, Telegram checks, templates, scheduler coordination, worker lifecycle, and failures.

### Changed

- The CLI and source development server supervise background scheduling. `--no-scheduler` and `REACHLOG_SCHEDULER_ENABLED=false` support existing external scheduling.
- Worker locks renew during long tasks. Competing mail-sync, follow-up, and backup workers report a skipped run with exit code 75.
- Failed follow-up notifications now produce a failed worker result and remain eligible for retry.
- Environment and `.env` settings retain precedence and are identified as read-only in the connection forms. Existing configurations continue to work.
- Build-time configuration and database paths are isolated from runtime data.

### Fixed

- Unresolved template variables are blocked at both the composer and server before sending. Incomplete drafts can still be saved.
- Connection test failures return safe messages without exposing provider credentials or tokens.
- Template field labels remain stable when validation errors appear. Warning and error color shades now coexist with the existing theme aliases.
- Scheduler coordination recovers after an expired lease, including sleep and wake, and completed runs clear the queued message.
- Added a browser icon to eliminate the missing favicon request.

### Upgrade

- Keep the existing data directory and back up the database before upgrading.
- Database migration 0007 adds templates and schedule state without rewriting existing contacts, messages, drafts, or earlier migrations.
- All built-in schedules start paused after upgrade. Enable them explicitly, or continue using external workers.
- Saved connection credentials are separate from SQLite backups. Back up `connections.json` and `.env` securely when migrating machines.

## 0.1.0 — 2026-09-05

- Initial packaged CLI release with persistent SQLite data, isolated demo mode, outreach tracking, CSV import and export, SMTP/IMAP support, manual follow-ups, persistent drafts, and native SQLite backups.
