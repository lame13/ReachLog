# Development and release

ReachLog uses Next.js 16, React, TypeScript and better-sqlite3. It is an application distributed through npm, not an importable JavaScript library.

## Checks

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

Use **Node.js 22 or 24**, as specified in `package.json`. Select a supported
version before installing dependencies and running the checks.

`npm run dev` runs source development and the scheduler on localhost. Schedules remain paused until enabled in Settings. Use `REACHLOG_SCHEDULER_ENABLED=false` for an externally scheduled development setup. `npm run demo:dev` uses sample data with connections and scheduling disabled. `npm run demo:reset` deletes the demo database and rebuilds it; never point that command at real data.

The development launcher loads Next's environment files before starting either process, so `.env.local` and `.env.development` settings apply to both the app and scheduler. `DOTENV_CONFIG_PATH` can select an external configuration file.

The regression suite uses disposable databases and local SMTP/IMAP fixtures, so it needs permission to listen on localhost. No real provider accounts or messages are used. It covers migration from the pre-0007 schema, credential persistence and redaction, connection checks, templates, worker leases, scheduler overlap, sleep recovery, failure reporting, and shutdown.

Production builds refuse local `.env` files in the source checkout. Keep runtime configuration in the external data directory. Build-time public variables and mail credentials are removed from the child build environment.

## Package structure

`npm run build` builds the Next.js app, copies its runtime output and static assets into `dist/app`, and bundles the TypeScript CLI and workers. The npm shrinkwrap locks the tested dependency tree, including the patched PostCSS version shipped by Next.js. Native SQLite binaries are installed on the user's machine by npm. They are not copied from the maintainer's build host.

The package allowlist contains `dist`, documentation, example configuration and the license. Source checkouts, caches, databases, private environment files, native binaries and build traces are excluded. `npm pack` runs typechecking, lint, regression tests, a fresh build and package inspection.

## Test an actual package

```sh
npm pack
```

In a different, empty directory:

```sh
npm init -y
npm install '/absolute/path/to/reachlog-<version>.tgz'
npx --no-install reachlog --data-dir ./test-data
```

Open the local address. Check creating a target, saving and reopening a draft, CSV duplicate preview, exports, restart persistence, a backup and a separate demo session. Verify that the CSS and browser scripts load. Use test data and leave external integrations disabled.

## Browser verification

For browser verification, use an already installed Playwright and Chrome:

```sh
node scripts/smoke-browser.mjs /absolute/path/to/node_modules/reachlog
```

The browser script owns its test database, local SMTP fixture, application process, and browser profile, and cleans them up afterward. It exercises templates, missing-variable handling, drafts, connection validation and verification, scheduled backups, restart persistence, authentication, and desktop/mobile layouts. `REACHLOG_PLAYWRIGHT_MODULE` and `REACHLOG_PLAYWRIGHT_TEST_MODULE` can point to an existing Playwright `index.mjs` and `test.mjs`; `REACHLOG_QA_CHROME` selects an installed Chrome executable. `REACHLOG_QA_OUTPUT` retains screenshots and failure evidence in a directory you choose. No tools or browsers are downloaded by this script.

## Publish a release

Update `package.json`, both root version fields in `npm-shrinkwrap.json`, `CHANGELOG.md`, and `RELEASE_NOTES.md`. Run the checks and install and exercise the resulting archive outside the checkout. Review and commit the release files, including any README images.

For 0.3.0, after committing on `master`:

```sh
git tag -a 0.3.0 -m "ReachLog 0.3.0"
git push origin master
git push origin 0.3.0
npm publish --access public
gh release create 0.3.0 --verify-tag --title "ReachLog 0.3.0" --notes-file RELEASE_NOTES.md
```

Sign in with `npm login` and `gh auth login` if needed. Tags use the version
number without a `v`, matching earlier releases. Publishing from the checkout
runs `prepack`: typecheck, lint, tests, a fresh build and package inspection.
After publishing, check the version, links and screenshots on the npm page.

Keep the `files` allowlist in `package.json` free of databases, connection files, private environment files and native binaries. `scripts/check-package.mjs` fails the build if any of them appear. Keep framework security updates current, and keep the release notes in `RELEASE_NOTES.md` short enough to read in a minute.

## Changes from the supplied private app

- Removed the private hosting URL and server paths from defaults and examples.
- Added a cross-platform CLI, persistent data directory and separate demo database.
- Required authentication for network exposure through the CLI.
- Added durable email drafts; the previous action stored only the body length.
- Removed external SQLite and gzip command requirements from backups.
- Added meaningful first-use instructions and simplified Settings and import wording.
- Updated dependencies affected by reported advisories and added Node 24 compatible SQLite support.

The 0.1.0 packaging work added `email_drafts`. Version 0.2.0 adds `email_templates` and `background_schedules`, preserving single-owner operation, manual sending, existing records, and automatic database migrations.
