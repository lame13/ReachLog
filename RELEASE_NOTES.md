# ReachLog 0.3.0

ReachLog now shows where to open the app, where your database lives and how to
stop it. If a port is busy, it explains how to choose another.

Pages have loading and error screens, with a retry button and details to include
in a bug report. Unknown addresses have links back to the dashboard and targets.

The Targets table is simpler: duplicate keys have moved to a tooltip on the
company name, and sources link to the original post or website when available.
Duplicate keys are still included in exports.

The README includes screenshots and instructions for trying the demo:

```sh
npx reachlog demo
```

Open the address printed in the terminal. The demo uses its own database and
does not send email or connect to a mailbox.

## Upgrading from 0.2.1

There is no new database migration; the schema remains at 0007. Keep your data
directory and configuration in place. Your records and schedule settings are
preserved. Node.js 22 or 24 is still required, and dependencies are unchanged.
