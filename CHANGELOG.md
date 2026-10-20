# Changelog

## 1.0.0 — 2026-10-20

ReachLog 1.0.0 focuses on **AI automation**: understanding replies, preparing
follow-ups, capturing inbound leads, and keeping the pipeline current. Bring
your own compatible provider and review suggestions before enabling more automation.

### Added

- **AI automation** through any OpenAI-compatible chat completions endpoint.
  Configure the base URL, API key, and model in Settings. OpenAI, DeepSeek,
  MiMo, OpenRouter, Ollama, LM Studio, and compatible gateways use the same
  client. Claude can be reached through an OpenAI-compatible gateway.
- **Reply triage** classifies each new inbound message, extracts asks and
  commitments with quoted evidence, moves the pipeline forward at high
  confidence, and saves a reply draft or schedules the next follow-up.
- **Follow-up autopilot** writes the next email from recent thread history and saves
  it on the due follow-up. Optional auto-send is limited to existing threads,
  has a daily cap, and respects every existing send guard.
- **Unlinked lead capture** turns inbound business mail that did not match a
  target into a target or an **AI review** item.
- **AI review** page for suggestions that need a human decision, with accept
  and reject actions and quoted evidence.
- AI assessment cards on target pages, an AI review counter in navigation, and
  a fourth background task for AI automation.
- `reachlog worker ai` for external scheduling.

### Changed

- Out-of-office and automatic replies no longer cancel follow-ups or mark a
  target as replied.
- SMTP sending moved into a shared module so the web app and the AI worker use
  the same guards, idempotency keys, and persistence path.
- Unlinked mail events now retain a reply snippet for AI classification.
- The npm README, package description, and CLI introduction lead with AI
  automation, with setup instructions for provider connections and background tasks.
- New sample-data screenshots show the AI review queue and conversation
  assessments, replacing the earlier targets and analytics screenshots.

### Fixed

- AI review items and target assessments now load their stored results correctly;
  accepting suggestions works, and cached results avoid repeat provider requests.
- Follow-up automation rechecks the task and conversation after drafting, so a
  new reply, cancellation, reschedule, or pipeline change prevents a stale send.
  Closed targets are excluded and edits to draft subjects are respected.
- Interrupted AI runs are retried on the next worker run. Provider failures now
  produce a failed worker exit status so background scheduling reports them.
- Provider error messages remain readable when no API key is configured, while
  configured keys stay redacted.

### Upgrade

- Database migration 0009 adds `ai_runs`, thread assessment fields, and the
  `ai` background schedule. Existing data is retained.
- AI is off by default. Configure a provider and enable the AI schedule before
  any automated work runs.
- Auto-send is off by default. Turn it on only after reviewing draft quality.

## 0.4.0 — 2026-09-29

### Added

- **Accounts** collect a company's contacts, targets, mail and notes. Adding or
  importing a target finds its account or creates one.
- **Contact pages** for editing a person's title, phone, tags, links, notes and
  account. Search the contacts list or filter it by domain, tag or account.
- **Pipeline board** with seven stages: New, Contacted, Replied, In conversation,
  Qualified, Won and Lost. Move targets between stages from the board or their
  edit form. Moving to Lost cancels open follow-ups; existing send blocks stay in place.
- **Activity timelines** on account, contact and target pages, including mail,
  notes, form submissions, follow-ups and stage changes.
- **Account exports** in CSV and JSON. Target and contact exports include the
  new CRM fields and respect the page's filters.
- Example systemd, Caddy and nginx configuration for hosting a public demo.

### Changed

- The navigation now has Pipeline, Accounts, Contacts and Targets. The dashboard
  shows a pipeline summary, and Analytics counts each stage.
- Contact email verification can be rechecked from the contact page, with or
  without a target.
- Demo mode is now read-only, locally and when hosted. Visitors can browse and
  export sample data; editing, imports and sending are blocked.
- The README explains the new pages and how to host the optional public demo.

### Upgrade

- Database migration 0008 adds `accounts`, `targets.stage`, `targets.account_id`
  and the new contact fields. Existing records and history are retained.
- Existing companies become accounts on first start: the company name, website
  or contact domain is used, so two targets for the same company share one
  account.
- Existing statuses are translated into stages (`replied` becomes Replied,
  `follow-up due` and `sent` become Contacted, `dead` becomes Lost, and so on).
  A stage you set by hand is never overwritten by a later start.
- The free-text status remains available and stays in exports. After the initial
  migration, you move pipeline stages by hand; mailbox sync does not change them.
- Keep your data directory and back up the database before upgrading. Node.js
  22 or 24 is still required, and dependencies are unchanged.

## 0.3.0 — 2026-09-27

### Added

- Error screens with a **Try again** button and details to include in a bug report.
- A loading placeholder and a 404 page with links back to the dashboard and targets.
- A startup message with the address to open, the database location and how to stop ReachLog. If the port is busy, the CLI explains how to choose another.
- Repository and issue tracker links on the npm page.
- Tests and publishing report unsupported Node versions before loading SQLite. The checkout includes an `.nvmrc` for Node 24.

### Changed

- A simpler Targets table: hover over a company name to see its duplicate key, or click its source to open the original post or website. Duplicate keys remain in exports.
- The README now includes screenshots and starts with the demo. Release instructions cover npm and GitHub.

### Upgrade

- No database migration. The schema remains at 0007.
- Keep using your existing data directory. Your records and schedule settings are preserved.

## 0.2.1 — 2026-09-15

### Added

- **Save to history** on the dashboard for email SMTP accepted but ReachLog could not record. Recovery saves the original sender, recipient and send date without sending again or scheduling another follow-up.
- A due follow-up count in desktop and mobile navigation, with guidance for using the app without Telegram reminders.
- Contacts exports in CSV and JSON, including email verification state and linked target counts.
- `reachlog verify-backup <file>` to check a compressed SQLite backup, report its schema and record counts, and reject damaged or incomplete backups before restoring.

### Changed

- Header search includes message subjects, bodies and addresses, plus contact form text and URLs. Search treats `%`, `_` and backslashes literally.
- Background tasks distinguish paused, enabled, never run, failed, skipped and interrupted states, with clearer timestamps and Run now behavior.
- Send review distinguishes failed sends from accepted messages missing their local records, and records the outcome of manual review.

### Fixed

- Sending to a recipient with an unresolved accepted send is blocked, including through another target for that recipient.
- Recovering older email preserves newer replies, target state, drafts and follow-ups; it uses the original thread and does not count recovery as another SMTP attempt. Recovery and its audit event commit together, and repeating recovery does not duplicate the message.
- Recovery refuses to guess a missing original sender from current SMTP settings, and links sends whose messages are already in history.
- Restored send events use the original send date so activity totals do not count them as new sends today.
- Removed the unreachable local notification channel and corrected the worker message when Telegram is disabled.
- ESLint ignores runtime copies under `.data/` so local captured packages do not break release checks.

### Upgrade

- No new database migration or dependency changes. The schema remains at 0007, and existing schedule settings are preserved.
- Keep your data directory and back up the database before upgrading. Protect `connections.json` and `.env` separately from SQLite backups.

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
