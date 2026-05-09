import { ImapFlow } from "imapflow";
import { env } from "../src/modules/core/env";

async function main() {
  if (!env.IMAP_ENABLED) {
    console.log("list-mailboxes skipped: IMAP_ENABLED=false");
    return;
  }

  const client = new ImapFlow({
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: false,
    auth: {
      user: env.IMAP_USER ?? "",
      pass: env.IMAP_PASS ?? ""
    }
  });

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
