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

`npm run dev` runs source development on localhost. `npm run demo:dev` uses sample data. `npm run demo:reset` deletes the demo database and rebuilds it; never point that command at real data.

Production builds refuse local `.env` files in the source checkout. Keep runtime configuration in the external data directory. Build-time public variables and mail credentials are removed from the child build environment.

## Package structure

`npm run build` builds the Next.js app, copies its runtime output and static assets into `dist/app`, and bundles the TypeScript CLI and workers. The published npm shrinkwrap locks the tested dependency tree, including the patched PostCSS version shipped by Next.js. Native SQLite binaries are installed on the user's machine by npm. They are not copied from the maintainer's build host.

The package allowlist contains `dist`, documentation, example configuration and the license. Source checkouts, caches, databases, private environment files, native binaries and build traces are excluded. `npm pack` runs typechecking, lint, regression tests, a fresh build and package inspection.

## Test an actual package

```sh
npm pack
```

In a different, empty directory:

```sh
npm init -y
npm install /absolute/path/to/reachlog-0.1.0.tgz
npx --no-install reachlog --data-dir ./test-data
```

Open the local address. Check creating a target, saving and reopening a draft, CSV duplicate preview, exports, restart persistence, a backup and a separate demo session. Verify that the CSS and browser scripts load. Use test data and leave external integrations disabled.

## Publish

The package name is `reachlog`. Registry availability must be checked again before publication; an unpublished name is not a reservation.

Review the MIT license and metadata, add the actual public repository URL when one exists, authenticate to npm, then publish the tested archive:

```sh
npm publish /absolute/path/to/reachlog-0.1.0.tgz --access public
```

Never publish a tarball that has not been installed and exercised outside the checkout. Future releases need a new version in `package.json` and a regenerated npm shrinkwrap. Keep framework security updates current.

## Changes from the supplied private app

- Removed the private hosting URL and server paths from defaults and examples.
- Added a cross-platform CLI, persistent data directory and separate demo database.
- Required authentication for network exposure through the CLI.
- Added durable email drafts; the previous action stored only the body length.
- Removed external SQLite and gzip command requirements from backups.
- Added meaningful first-use instructions and simplified Settings and import wording.
- Updated dependencies affected by reported advisories and added Node 24 compatible SQLite support.

This release preserves single-owner operation, manual sending, the existing data schema and automatic database migrations. The only new table is `email_drafts`.
