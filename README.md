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

Start with [examples/reachlog.env.example](examples/reachlog.env.example). Copy it outside the package directory, into your data directory as `.env`, and add only the connections you need.

[Configuration and hosting](docs/configuration.md) covers SMTP, Proton Bridge, IMAP, authentication, scheduled jobs and backups.

Run a worker once:

```sh
reachlog worker mail-sync
reachlog worker followup-check
reachlog worker backup
```

Workers do not start automatically. Schedule the ones you need. Follow-up notifications do not send follow-up emails.

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
