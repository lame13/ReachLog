import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { env } from "../src/modules/core/env";
import { getSqlite } from "../src/modules/core/db/client";
import { createId } from "../src/modules/core/ids";
import {
  extractThreadHeaderCandidates,
  normalizeSubject
} from "../src/modules/mailbox/threading";

const mailboxes = ["INBOX", "Sent"];

type TargetMatch = {
  targetId: string;
  contactId: string | null;
};

type ThreadMatch = {
  threadId: string;
  targetId: string;
  contactId: string | null;
  firstMessageId: string | null;
};

async function main() {
  if (!env.IMAP_ENABLED) {
    console.log("mail-sync skipped: IMAP_ENABLED=false");
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
    for (const mailbox of mailboxes) {
      await importMailbox(client, mailbox);
    }
  } finally {
    await client.logout();
  }
}

async function importMailbox(client: ImapFlow, mailbox: string) {
  const sqlite = getSqlite();
  const lock = await client.getMailboxLock(mailbox);
  let imported = 0;
  let skipped = 0;

  try {
    for await (const message of client.fetch("1:*", {
      envelope: true,
      source: true
    })) {
      if (!message.source) {
        skipped += 1;
        continue;
      }

      const parsed = await simpleParser(message.source);
      const messageId = parsed.messageId;

      if (!messageId) {
        skipped += 1;
        continue;
      }

      const exists = sqlite
        .prepare("SELECT id FROM messages WHERE message_id = ?")
        .get(messageId);

      if (exists) {
        skipped += 1;
        continue;
      }

      const subject = parsed.subject ?? "(no subject)";
      const normalizedSubject = normalizeSubject(subject);
      const direction = isSentMailbox(mailbox) ? "outbound" : "inbound";
      const thread = findOrCreateThread({
        parsed,
        mailbox,
        direction,
        subject,
        normalizedSubject,
        messageId
      });

      if (!thread) {
        createUnlinkedMailEvent({
          mailbox,
          parsed,
          messageId,
          subject,
          normalizedSubject
        });
        imported += 1;
        continue;
      }

      insertMessage({
        parsed,
        thread,
        mailbox,
        direction,
        subject,
        messageId
      });

      imported += 1;
    }
  } finally {
    lock.release();
  }

  console.log(`mail-sync ${mailbox}: ${imported} new, ${skipped} skipped`);
}

function findOrCreateThread({
  parsed,
  mailbox,
  direction,
  subject,
  normalizedSubject,
  messageId
}: {
  parsed: ParsedMail;
  mailbox: string;
  direction: "inbound" | "outbound";
  subject: string;
  normalizedSubject: string;
  messageId: string;
}): ThreadMatch | null {
  const headerThread = findThreadByHeaders({
    messageId,
    inReplyTo: parsed.inReplyTo,
    references: getReferencesHeader(parsed)
  });

  if (headerThread) {
    return headerThread;
  }

  const participantEmail =
    direction === "inbound"
      ? firstAddress(parsed.from)
      : firstAddress(Array.isArray(parsed.to) ? parsed.to[0] : parsed.to);

  if (!participantEmail) {
    return null;
  }

  const target = findTargetByEmail(participantEmail);

  if (!target) {
    return null;
  }

  const existingThread = findThreadByTargetAndSubject(
    target.targetId,
    normalizedSubject
  );

  if (existingThread) {
    return existingThread;
  }

  return createThread({
    target,
    mailbox,
    subject,
    normalizedSubject,
    messageId,
    direction,
    messageDate: getMessageDate(parsed)
  });
}

function findThreadByHeaders(headers: {
  messageId: string;
  inReplyTo?: string | null;
  references?: string | null;
}) {
  const candidates = extractThreadHeaderCandidates(headers);

  if (!candidates.length) {
    return null;
  }

  const placeholders = candidates.map(() => "?").join(", ");

  return getSqlite()
    .prepare(
      `
      SELECT
        threads.id as threadId,
        threads.target_id as targetId,
        threads.contact_id as contactId,
        threads.first_message_id as firstMessageId
      FROM messages
      INNER JOIN threads ON threads.id = messages.thread_id
      WHERE messages.message_id IN (${placeholders})
      ORDER BY messages.created_at DESC
      LIMIT 1
    `
    )
    .get(...candidates) as ThreadMatch | undefined;
}

function findTargetByEmail(email: string) {
  return getSqlite()
    .prepare(
      `
      SELECT
        targets.id as targetId,
        contacts.id as contactId
      FROM contacts
      INNER JOIN targets ON targets.contact_id = contacts.id
      WHERE lower(contacts.email) = ?
      ORDER BY targets.updated_at DESC
      LIMIT 1
    `
    )
    .get(email.toLowerCase()) as TargetMatch | undefined;
}

function findThreadByTargetAndSubject(targetId: string, normalizedSubject: string) {
  const sqlite = getSqlite();
  const bySubject = sqlite
    .prepare(
      `
      SELECT
        id as threadId,
        target_id as targetId,
        contact_id as contactId,
        first_message_id as firstMessageId
      FROM threads
      WHERE target_id = ?
        AND normalized_subject = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `
    )
    .get(targetId, normalizedSubject) as ThreadMatch | undefined;

  if (bySubject) {
    return bySubject;
  }

  return sqlite
    .prepare(
      `
      SELECT
        id as threadId,
        target_id as targetId,
        contact_id as contactId,
        first_message_id as firstMessageId
      FROM threads
      WHERE target_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `
    )
    .get(targetId) as ThreadMatch | undefined;
}

function createThread({
  target,
  mailbox,
  subject,
  normalizedSubject,
  messageId,
  direction,
  messageDate
}: {
  target: TargetMatch;
  mailbox: string;
  subject: string;
  normalizedSubject: string;
  messageId: string;
  direction: "inbound" | "outbound";
  messageDate: string;
}) {
  const threadId = createId("thread");
  const now = new Date().toISOString();

  getSqlite()
    .prepare(
      `
      INSERT INTO threads (
        id, target_id, contact_id, mailbox, subject, normalized_subject,
        first_message_id, last_message_id, last_inbound_at, last_outbound_at,
        next_followup_at, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `
    )
    .run(
      threadId,
      target.targetId,
      target.contactId,
      mailbox,
      subject,
      normalizedSubject,
      messageId,
      messageId,
      direction === "inbound" ? messageDate : null,
      direction === "outbound" ? messageDate : null,
      direction === "inbound" ? "replied" : "waiting",
      now,
      now
    );

  return {
    threadId,
    targetId: target.targetId,
    contactId: target.contactId,
    firstMessageId: messageId
  };
}

function insertMessage({
  parsed,
  thread,
  mailbox,
  direction,
  subject,
  messageId
}: {
  parsed: ParsedMail;
  thread: ThreadMatch;
  mailbox: string;
  direction: "inbound" | "outbound";
  subject: string;
  messageId: string;
}) {
  const sqlite = getSqlite();
  const messageDate = getMessageDate(parsed);
  const now = new Date().toISOString();
  const fromEmail = firstAddress(parsed.from) ?? "unknown";
  const toEmail = addressText(parsed.to) || "unknown";
  const referencesHeader = getReferencesHeader(parsed);

  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare(
        `
        INSERT INTO messages (
          id, thread_id, direction, from_email, to_email, cc, bcc, subject,
          body_text, body_html, message_id, in_reply_to, references_header,
          sent_at, received_at, raw_headers_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        createId("message"),
        thread.threadId,
        direction,
        fromEmail,
        toEmail,
        addressText(parsed.cc) || null,
        addressText(parsed.bcc) || null,
        subject,
        parsed.text || null,
        typeof parsed.html === "string" ? parsed.html : null,
        messageId,
        parsed.inReplyTo || null,
        referencesHeader,
        direction === "outbound" ? messageDate : null,
        direction === "inbound" ? messageDate : null,
        rawHeadersJson(parsed),
        now
      );

    sqlite
      .prepare(
        `
        UPDATE threads
        SET last_message_id = ?,
            last_inbound_at = CASE WHEN ? = 'inbound' THEN ? ELSE last_inbound_at END,
            last_outbound_at = CASE WHEN ? = 'outbound' THEN ? ELSE last_outbound_at END,
            next_followup_at = CASE WHEN ? = 'inbound' THEN NULL ELSE next_followup_at END,
            status = ?,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        messageId,
        direction,
        messageDate,
        direction,
        messageDate,
        direction,
        direction === "inbound" ? "replied" : "waiting",
        now,
        thread.threadId
      );

    sqlite
      .prepare("UPDATE targets SET status = ?, updated_at = ? WHERE id = ?")
      .run(direction === "inbound" ? "replied" : "sent", now, thread.targetId);

    if (direction === "inbound") {
      sqlite
        .prepare(
          `
          UPDATE followup_tasks
          SET status = 'cancelled',
              completed_at = ?
          WHERE status = 'open'
            AND (target_id = ? OR thread_id = ?)
        `
        )
        .run(now, thread.targetId, thread.threadId);
    }

    sqlite
      .prepare(
        `
        INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at)
        VALUES (?, 'target', ?, ?, ?, ?)
      `
      )
      .run(
        createId("event"),
        thread.targetId,
        direction === "inbound" ? "reply_received" : "email_sent",
        JSON.stringify({
          mailbox,
          messageId,
          subject,
          from: fromEmail,
          to: toEmail
        }),
        now
      );
  });

  transaction();
}

function createUnlinkedMailEvent({
  mailbox,
  parsed,
  messageId,
  subject,
  normalizedSubject
}: {
  mailbox: string;
  parsed: ParsedMail;
  messageId: string;
  subject: string;
  normalizedSubject: string;
}) {
  getSqlite()
    .prepare(
      "INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, 'mailbox', ?, 'mail_seen_unlinked', ?, ?)"
    )
    .run(
      createId("event"),
      mailbox,
      JSON.stringify({
        messageId,
        subject,
        normalizedSubject,
        from: parsed.from?.text,
        to: addressText(parsed.to)
      }),
      new Date().toISOString()
    );
}

function firstAddress(addressObject: ParsedMail["from"]) {
  return addressObject?.value[0]?.address?.toLowerCase() ?? null;
}

function addressText(
  addressObject: ParsedMail["to"] | ParsedMail["cc"] | ParsedMail["bcc"]
) {
  if (Array.isArray(addressObject)) {
    return addressObject.map((entry) => entry.text).join(", ");
  }

  return addressObject?.text ?? "";
}

function getReferencesHeader(parsed: ParsedMail) {
  if (Array.isArray(parsed.references)) {
    return parsed.references.join(" ");
  }

  return parsed.references ?? null;
}

function getMessageDate(parsed: ParsedMail) {
  return parsed.date?.toISOString() ?? new Date().toISOString();
}

function rawHeadersJson(parsed: ParsedMail) {
  return JSON.stringify(
    Array.from(parsed.headers.entries()).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(", ") : String(value)
    ])
  );
}

function isSentMailbox(mailbox: string) {
  return mailbox.toLowerCase().includes("sent");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
