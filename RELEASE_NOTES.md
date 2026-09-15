# ReachLog 0.2.1

This patch improves send recovery, follow-up visibility, scheduler status, exports and search. See [CHANGELOG.md](CHANGELOG.md) for the full change list.

## What to try

1. **Dashboard → Sending needs review:** use **Save to history** for email your mail server accepted but ReachLog could not save. It records the email without sending again. Newer replies, drafts and follow-ups are preserved. Sending to that recipient stays blocked until the earlier send is saved or marked checked.
2. **Follow-ups:** the navigation shows a due count even without Telegram. Settings explains the reminder fallback and background task states.
3. **Targets:** export contacts as CSV or JSON, including verification state and linked target counts. Header search also finds message text and contact form submissions.
4. **Before restoring a backup:** run `reachlog verify-backup /path/to/backup.sqlite.gz`. Check the reported schema and counts. Damaged archives and files missing ReachLog tables fail with a non-zero exit status.

## Upgrading from 0.2.0

- Keep the existing data directory and back up the database before upgrading. There is no new migration; the schema remains at 0007.
- Existing schedule settings are preserved. New schedules start paused, and missed intervals are not replayed.
- Back up `connections.json` and `.env` separately; they are not included in SQLite backups.
- Node.js 22 or 24 is required. Dependency versions are unchanged.

## Verification

- Node.js 24.18.0: typecheck, lint, all 24 tests, production build and package inspection passed.
- Installed the 0.2.1 tarball in an empty folder and checked it with headless Chrome: send recovery preserved the newer reply, draft and follow-up; navigation badges, message search, contacts CSV/JSON, all application pages, backups and backup verification passed.
- Desktop and mobile screenshots were inspected. No browser runtime errors, failed application requests or server-action origin warnings occurred. The checks used disposable local data with external integrations disabled.
