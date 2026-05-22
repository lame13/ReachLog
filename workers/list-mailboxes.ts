import { ImapFlow } from "imapflow";
import { env } from "../src/modules/core/env";
import { getImapFlowOptions, getImapSecurityMode } from "../src/modules/mailbox/imap-client";

async function main() {
  if (env.DEMO_MODE) {
    console.log("list-mailboxes skipped: DEMO_MODE=true");
    return;
  }

  if (!env.IMAP_ENABLED) {
    console.log("list-mailboxes skipped: IMAP_ENABLED=false");
    return;
  }

  console.log(
    `list-mailboxes connecting ${env.IMAP_HOST}:${env.IMAP_PORT} security=${getImapSecurityMode()} tlsVerify=${String(env.IMAP_TLS_VERIFY)}`
  );

  const client = new ImapFlow(getImapFlowOptions());

  await client.connect();

  try {
    const mailboxes = await client.list();

    for (const mailbox of mailboxes) {
      console.log(mailbox.path);
    }
  } finally {
    await client.logout();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
