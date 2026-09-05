# ReachLog 0.1.0 release candidate — 5 September 2026

Prepared from the supplied ReachLog-master.zip. Not published to npm: this workspace has no authenticated npm account.

## What changed

- Added an npm executable: `reachlog`, `reachlog demo`, and `reachlog worker <name>`.
- Data defaults to `~/.reachlog`, outside the package installation. Demo uses a separate database. Existing hosting paths must be set explicitly when moving an older deployment.
- Removed private hosting URLs and owner email examples from release documentation and defaults. Example contacts now use reserved example domains.
- Fixed Save draft: subject, body and sender are stored in SQLite, restored when reopening the composer, and cleared on successful sending.
- Backups use SQLite's native backup API and Node compression. Repeated backups get unique names; external sqlite3/gzip commands are no longer required.
- Simplified first-use, Settings and import wording. Added a first-contact action instead of an empty dashboard of metrics.
- Added authentication checks before allowing network access through the CLI. Mail, mailbox sync, verification and notifications remain off until configured.
- Updated vulnerable dependencies, including Next.js 16.3.4 and its supported authentication proxy convention. Updated SQLite for Node 24 compatibility. The original Next.js 15 dependency tree retained a vulnerable PostCSS version in a clean consumer install; a source-only override did not solve the shipped package.
- Added a package allowlist, published npm shrinkwrap, MIT license, configuration guide and repeatable release checks.

## Verification completed

Tested the exact supplied tarball in a new npm project on Linux with Node 24.19.0:

- npm installation completed, including native SQLite.
- TypeScript, ESLint and production build passed.
- Five regression checks passed: migrations preserve records, draft persistence, backup restoration, CSV duplicate preview and CLI input/network guards.
- HTTP integration checks passed: fresh dashboard, every main route, ten CSS/JS assets, contact creation, draft save/reopen, JSON exports, restart persistence and packaged backup worker.
- Separate demo data and a simulated email send passed. The ordinary database remained unchanged.
- Unauthenticated pages and exports returned 401; authenticated access returned the existing records. A middleware-subrequest bypass probe remained unauthorized.
- A clean consumer `npm audit --omit=dev` reported zero advisories.
- The tarball contains no database, private .env file, native binary, cache or source checkout.

## Checks still required before claiming full release QA

The cloud browser could not access the local listener (ERR_BLOCKED_BY_CLIENT). Desktop/mobile visual behavior and browser hydration were not verified. The HTTP checks do not substitute for those checks.

Real SMTP, IMAP, Telegram and EmailListVerify accounts were not connected. No real emails or notifications were sent. macOS, Windows and Node 22 were not exercised here.

## Publish the prepared package

The tarball is already built. It does not require another build to publish.

1. Review the MIT license and package metadata.
2. Install the tarball locally and check the desktop/mobile interface before publishing:

```sh
npm install --global ./reachlog-0.1.0.tgz
reachlog demo
```

3. Authenticate to your npm account on your own machine, then publish:

```sh
npm login
npm publish ./reachlog-0.1.0.tgz --access public
```

The unscoped name `reachlog` returned 404 during inspection; that is not a name reservation. If it becomes unavailable, change the package name to your scope and rebuild. Do not publish under someone else's existing name.

Tarball SHA-256: `698d062b58f28ccef51c61c76a3dbb52d7fe61eec3dba3b9e0436c38b61ecae9`

## Source archive

The source ZIP includes the modified application, configuration examples, docs, regression tests and `scripts/smoke-package.mjs`. It excludes node_modules, generated builds, databases and local Git history.

```sh
npm ci
npm run build
npm start
```

To reproduce the installed-package workflow test, install the tarball in an empty project and run the source script with that installed package's absolute path:

```sh
node scripts/smoke-package.mjs /absolute/path/to/node_modules/reachlog
```

It creates temporary test data, disables external connections, tests the app, and removes its own temporary data afterward.
