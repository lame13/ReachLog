# ReachLog 1.2.0

ReachLog now keeps the people around an opportunity visible and makes it safer
to clean up duplicate records as the pipeline grows.

## People and roles

Each opportunity keeps one primary contact for mail and sending safely. Add
other people from their contact records when the decision involves a champion,
decision maker, user, finance lead, blocker or another stakeholder. Contact
pages show every opportunity role held by that person.

## Review possible duplicates

Accounts and Contacts now link to a duplicate review when ReachLog finds likely
matches. ReachLog never merges automatically: both records are shown side by
side, and the merge requires confirmation before activity is moved.

## Quiet opportunities

The existing follow-up background task now also sends one batched Telegram
reminder for opportunities with no next step. Without Telegram, the same
opportunities remain visible in Today.

## Upgrade

Upgrade in place. Migrations 0011 and 0012 preserve every existing contact,
target, message, follow-up and setting. Stakeholder roles and duplicate cleanup
are optional.

```sh
npm install --global reachlog@1.2.0
```
