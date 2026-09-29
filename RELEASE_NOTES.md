# ReachLog 0.4.0

ReachLog now keeps companies and people as records of their own, and shows your
outreach on a pipeline board. Accounts, contacts and targets each have an
activity timeline, and the new fields are included in CSV and JSON exports.

## Accounts and contacts

Every target already named a company. ReachLog now turns those companies into
**accounts**: created for you when you add or import a target, and available on
their own page with the contacts, targets, mail and notes that belong to them.
Targets are matched to accounts by company domain, or by name when no domain is
available.

**Contacts** get a list and a page of their own, with a title, phone, tags,
links, notes and the account they belong to. Filter by search, domain, tag or
account.

## Pipeline

Every target now has a stage: **New, Contacted, Replied, In conversation,
Qualified, Won** or **Lost**. The new `/pipeline` page shows a column per stage,
and moving a card updates the stage, keeps the outreach status in step, and
records the move on the shared timeline. Moving a card to Lost cancels that
target's open follow-ups, the same as marking it dead always did. The dashboard
and Analytics count each stage.

Existing send blocks stay in place when you move a card. The free-text status
is still available and included in exports. Stages are managed by hand after
the initial migration; mailbox sync does not move cards.

## Read-only demo

`reachlog demo` now lets you browse sample data without changing it. Editing,
imports and sending are blocked. The package includes systemd, Caddy and nginx
examples for hosting a public demo with `REACHLOG_DEMO_PUBLIC=true`.

## Upgrading from 0.3.0

```sh
npm install --global reachlog@0.4.0
```

Database migration 0008 runs on first start. Your companies become accounts,
your existing statuses are translated into stages, and your records and history
are retained. A stage you set by hand is never overwritten by a later start. Keep your
data directory and back up your database first.

Node.js 22 or 24 is still required, and dependencies are unchanged.
