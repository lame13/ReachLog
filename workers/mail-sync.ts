import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { env } from "../src/modules/core/env";
import { getSqlite } from "../src/modules/core/db/client";
import { withWorkerLock } from "../src/modules/core/db/locks";
import { createId } from "../src/modules/core/ids";
import { targetUrl } from "../src/modules/core/urls";
import { notifyWorkerFailure } from "../src/modules/core/worker-alerts";
import {
  extractThreadHeaderCandidates,
  normalizeSubject
} from "../src/modules/mailbox/threading";
import { getImapFlowOptions, getImapSecurityMode } from "../src/modules/mailbox/imap-client";
import {
  completeMailResyncRequests,
  getPendingMailResyncRequest
} from "../src/modules/mailbox/resync-requests";
import { normalizeDomain } from "../src/modules/outreach/dedupe";
import { getConfiguredSmtpEmailAddresses } from "../src/modules/smtp/from-identities";
import { sendTelegramMessage } from "../src/modules/telegram/notify";

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

const DOMAIN_FALLBACK_DENYLIST = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
  "hey.com",
  "fastmail.com",
  "mail.com"
]);
const OWNED_MAILBOX_EMAILS = new Set([
  ...getConfiguredSmtpEmailAddresses(),
  env.IMAP_USER?.toLowerCase() ?? ""
].filter(Boolean));

async function main() {
  if (env.DEMO_MODE) {
    console.log("mail-sync skipped: DEMO_MODE=true");
    return;
  }

  if (!env.IMAP_ENABLED) {
    console.log("mail-sync skipped: IMAP_ENABLED=false");
    return;
  }

  await withWorkerLock("mail-sync", 1800, runMailSync);
}

async function runMailSync() {
  const pendingResync = getPendingMailResyncRequest();
  const manualResyncDays = getManualResyncDays();
  const resyncDays = Math.max(manualResyncDays, pendingResync.days);

  console.log(
    `mail-sync connecting ${env.IMAP_HOST}:${env.IMAP_PORT} security=${getImapSecurityMode()} tlsVerify=${String(env.IMAP_TLS_VERIFY)} resyncDays=${resyncDays || 0} pendingResyncJobs=${pendingResync.jobIds.length}`
  );

  const client = new ImapFlow(getImapFlowOptions());

  await client.connect();

  try {
    for (const mailbox of getConfiguredMailboxes()) {
      await importMailbox(client, mailbox, resyncDays);
    }

    completeMailResyncRequests(pendingResync.jobIds);
  } finally {
    await client.logout();
  }
}

async function importMailbox(client: ImapFlow, mailbox: string, resyncDays: number) {
  const sqlite = getSqlite();
  const lock = await client.getMailboxLock(mailbox);
  let imported = 0;
  let skipped = 0;

  try {
    const uidValidity = client.mailbox ? Number(client.mailbox.uidValidity) : null;
    const cursor = getMailboxCursor(mailbox, uidValidity);
    const uidNext = client.mailbox ? client.mailbox.uidNext : null;

    if (!resyncDays && uidNext && cursor.lastUid >= uidNext - 1) {
      console.log(`mail-sync ${mailbox}: no new messages`);
      return;
    }

    const fetchRange = await getFetchRange(
      client,
      resyncDays ? 0 : cursor.lastUid,
      uidNext,
      resyncDays
    );

    if (!fetchRange) {
      console.log(`mail-sync ${mailbox}: no messages in lookback window`);
      return;
    }

    for await (const message of client.fetch(
      fetchRange,
      {
        envelope: true,
        source: true
      },
      { uid: true }
    )) {
      if (!message.source) {
        skipped += 1;
        updateMailboxCursor(mailbox, uidValidity, message.uid);
        continue;
      }

      const parsed = await simpleParser(message.source);
      const messageId = parsed.messageId;

      if (!messageId) {
        skipped += 1;
        updateMailboxCursor(mailbox, uidValidity, message.uid);
        continue;
      }

      const exists = sqlite
        .prepare("SELECT id FROM messages WHERE message_id = ?")
        .get(messageId);

      if (exists) {
        skipped += 1;
        updateMailboxCursor(mailbox, uidValidity, message.uid);
        continue;
      }

      const subject = parsed.subject ?? "(no subject)";
      const normalizedSubject = normalizeSubject(subject);
      const fromEmail = firstAddress(parsed.from) ?? "";
      const direction = getMessageDirection(mailbox, fromEmail);
      const notification = classifyNonActionableInboundMessage(
        parsed,
        subject,
        fromEmail,
        direction
      );
      const thread = findOrCreateThread({
        parsed,
        mailbox,
        direction,
        subject,
        normalizedSubject,
        messageId,
        nonActionableInbound: notification.nonActionable
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
        updateMailboxCursor(mailbox, uidValidity, message.uid);
        continue;
      }

      await insertMessage({
        parsed,
        thread,
        mailbox,
        direction,
        subject,
        messageId,
        nonActionableInbound: notification.nonActionable,
        nonActionableReason: notification.reason
      });

      imported += 1;
      updateMailboxCursor(mailbox, uidValidity, message.uid);
    }
  } finally {
    lock.release();
  }

  console.log(`mail-sync ${mailbox}: ${imported} new, ${skipped} skipped`);
}

function getConfiguredMailboxes() {
  return env.IMAP_MAILBOXES.split(",")
    .map((mailbox) => mailbox.trim())
    .filter(Boolean);
}

function getManualResyncDays() {
  const value = Number(process.env.MAIL_SYNC_RESYNC_DAYS ?? 0);

  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

async function getFetchRange(
  client: ImapFlow,
  lastUid: number,
  uidNext: number | null,
  resyncDays: number
) {
  if (resyncDays > 0) {
    const since = new Date();
    since.setDate(since.getDate() - resyncDays);

    const uids = await client.search({ since }, { uid: true });

    return uids && uids.length > 0 ? uids : null;
  }

  if (lastUid > 0) {
    return `${lastUid + 1}:*`;
  }

  if (env.IMAP_LOOKBACK_DAYS <= 0) {
    return "1:*";
  }

  const since = new Date();
  since.setDate(since.getDate() - env.IMAP_LOOKBACK_DAYS);

  const uids = await client.search({ since }, { uid: true });

  if (!uids || uids.length === 0) {
    if (uidNext && uidNext > 1 && client.mailbox) {
      updateMailboxCursor(client.mailbox.path, Number(client.mailbox.uidValidity), uidNext - 1);
    }

    return null;
  }

  return uids;
}

function getMailboxCursor(mailbox: string, uidValidity: number | null) {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare(
      "SELECT uid_validity as uidValidity, last_uid as lastUid FROM mailbox_cursors WHERE mailbox = ?"
    )
    .get(mailbox) as { uidValidity: number | null; lastUid: number } | undefined;

  if (!row) {
    return { lastUid: 0 };
  }

  if (uidValidity && row.uidValidity && row.uidValidity !== uidValidity) {
    sqlite
      .prepare("UPDATE mailbox_cursors SET uid_validity = ?, last_uid = 0, updated_at = ? WHERE mailbox = ?")
      .run(uidValidity, new Date().toISOString(), mailbox);
    return { lastUid: 0 };
  }

  return { lastUid: row.lastUid ?? 0 };
}

function updateMailboxCursor(
  mailbox: string,
  uidValidity: number | null,
  lastUid: number
) {
  getSqlite()
    .prepare(
      `
      INSERT INTO mailbox_cursors (mailbox, uid_validity, last_uid, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(mailbox) DO UPDATE SET
        uid_validity = excluded.uid_validity,
        last_uid = MAX(mailbox_cursors.last_uid, excluded.last_uid),
        updated_at = excluded.updated_at
    `
    )
    .run(mailbox, uidValidity, lastUid, new Date().toISOString());
}

function findOrCreateThread({
  parsed,
  mailbox,
  direction,
  subject,
  normalizedSubject,
  messageId,
  nonActionableInbound
}: {
  parsed: ParsedMail;
  mailbox: string;
  direction: "inbound" | "outbound";
  subject: string;
  normalizedSubject: string;
  messageId: string;
  nonActionableInbound: boolean;
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

  const target = findTargetByParticipantEmail(participantEmail);

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
    messageDate: getMessageDate(parsed),
    nonActionableInbound
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

function findTargetByParticipantEmail(email: string) {
  const sqlite = getSqlite();
  const exactMatch = sqlite
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

  if (exactMatch) {
    return exactMatch;
  }

  const domain = getEmailDomain(email);

  if (!domain) {
    return null;
  }

  if (DOMAIN_FALLBACK_DENYLIST.has(domain)) {
    return null;
  }

  return sqlite
    .prepare(
      `
      SELECT
        targets.id as targetId,
        contacts.id as contactId
      FROM targets
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      WHERE lower(contacts.domain) = ?
         OR lower(targets.website_url) LIKE ?
      ORDER BY targets.updated_at DESC
      LIMIT 1
    `
    )
    .get(domain, `%${domain}%`) as TargetMatch | undefined;
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

  return null;
}

function createThread({
  target,
  mailbox,
  subject,
  normalizedSubject,
  messageId,
  direction,
  messageDate,
  nonActionableInbound
}: {
  target: TargetMatch;
  mailbox: string;
  subject: string;
  normalizedSubject: string;
  messageId: string;
  direction: "inbound" | "outbound";
  messageDate: string;
  nonActionableInbound: boolean;
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
      direction === "inbound" && !nonActionableInbound ? messageDate : null,
      direction === "outbound" ? messageDate : null,
      direction === "inbound"
        ? nonActionableInbound
          ? "notification"
          : "replied"
        : "waiting",
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

async function insertMessage({
  parsed,
  thread,
  mailbox,
  direction,
  subject,
  messageId,
  nonActionableInbound,
  nonActionableReason
}: {
  parsed: ParsedMail;
  thread: ThreadMatch;
  mailbox: string;
  direction: "inbound" | "outbound";
  subject: string;
  messageId: string;
  nonActionableInbound: boolean;
  nonActionableReason: string | null;
}) {
  const sqlite = getSqlite();
  const messageDate = getMessageDate(parsed);
  const now = new Date().toISOString();
  const fromEmail = firstAddress(parsed.from) ?? "unknown";
  const toEmail = addressText(parsed.to) || "unknown";
  const referencesHeader = getReferencesHeader(parsed);
  const isBounce =
    direction === "inbound" &&
    isDeliveryFailureMessage(parsed, subject, fromEmail);
  const isNotification = nonActionableInbound && !isBounce;
  const replySnippet =
    direction === "inbound" && !isBounce && !isNotification
      ? extractReplySnippet(parsed.text)
      : "";

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

    const state = updateThreadAfterMessage({
      threadId: thread.threadId,
      direction,
      messageDate,
      messageId,
      isBounce,
      nonActionableInbound: isNotification
    });

    if (isBounce) {
      sqlite
        .prepare("UPDATE targets SET status = 'bounced_dead_address', updated_at = ? WHERE id = ?")
        .run(now, thread.targetId);
    } else if (!isNotification) {
      sqlite
        .prepare(
          `
          UPDATE targets
          SET status = CASE
                WHEN ? = 1 THEN 'replied'
                WHEN lower(status) IN ('new', 'dedupe protected', 'follow-up due', 'queued', 'replied') THEN 'sent'
                ELSE status
              END,
              updated_at = ?
          WHERE id = ?
        `
        )
        .run(state.latestIsInbound ? 1 : 0, now, thread.targetId);
    }

    if (state.latestIsInbound || isBounce) {
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
        isBounce
          ? "email_bounced"
          : isNotification
            ? "mail_notification_received"
            : direction === "inbound"
              ? "reply_received"
              : "email_sent",
        JSON.stringify({
          mailbox,
          messageId,
          messageDate,
          syncedAt: now,
          subject,
          from: fromEmail,
          to: toEmail,
          replySnippet: replySnippet || undefined,
          bounced: isBounce,
          nonActionable: isNotification,
          reason: nonActionableReason
        }),
        messageDate
      );

    return state;
  });

  const state = transaction();

  if (direction === "inbound" && state.latestIsInbound && !isBounce && !isNotification) {
    await sendTelegramMessage(formatReplyTelegramMessage({
      fromEmail,
      subject,
      replySnippet,
      targetId: thread.targetId
    }));
  }
}

function formatReplyTelegramMessage({
  fromEmail,
  subject,
  replySnippet,
  targetId
}: {
  fromEmail: string;
  subject: string;
  replySnippet: string;
  targetId: string;
}) {
  return [
    `Reply received: ${fromEmail}`,
    subject,
    replySnippet ? `\n${replySnippet}` : "",
    targetUrl(targetId)
  ]
    .filter(Boolean)
    .join("\n");
}

function extractReplySnippet(text: string | undefined) {
  if (!text) {
    return "";
  }

  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const replyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (isQuotedReplyBoundary(trimmed, replyLines.length > 0)) {
      break;
    }

    if (trimmed.startsWith(">")) {
      continue;
    }

    replyLines.push(line);
  }

  return trimSnippet(
    replyLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function isQuotedReplyBoundary(line: string, hasReplyText: boolean) {
  if (!line) {
    return false;
  }

  if (/^--\s*$/.test(line)) {
    return true;
  }

  if (/^sent from my /i.test(line)) {
    return true;
  }

  if (/^-{2,}\s*original message\s*-{2,}$/i.test(line)) {
    return true;
  }

  if (/^on .+wrote:$/i.test(line)) {
    return true;
  }

  if (/^_{5,}$/.test(line) || /^-{5,}$/.test(line)) {
    return true;
  }

  return hasReplyText && /^(from|sent|to|subject):\s.+/i.test(line);
}

function trimSnippet(text: string) {
  const normalized = text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  const maxLength = 1200;

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function updateThreadAfterMessage({
  threadId,
  direction,
  messageDate,
  messageId,
  isBounce,
  nonActionableInbound
}: {
  threadId: string;
  direction: "inbound" | "outbound";
  messageDate: string;
  messageId: string;
  isBounce: boolean;
  nonActionableInbound: boolean;
}) {
  const sqlite = getSqlite();
  const now = new Date().toISOString();

  if (direction === "inbound" && !nonActionableInbound) {
    sqlite
      .prepare(
        `
        UPDATE threads
        SET last_inbound_at = CASE
              WHEN last_inbound_at IS NULL OR ? > last_inbound_at THEN ?
              ELSE last_inbound_at
            END,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(messageDate, messageDate, now, threadId);
  } else if (direction === "outbound") {
    sqlite
      .prepare(
        `
        UPDATE threads
        SET last_outbound_at = CASE
              WHEN last_outbound_at IS NULL OR ? > last_outbound_at THEN ?
              ELSE last_outbound_at
            END,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(messageDate, messageDate, now, threadId);
  }

  const state = sqlite
    .prepare(
      `
      SELECT
        threads.last_inbound_at as lastInboundAt,
        threads.last_outbound_at as lastOutboundAt,
        (
          SELECT messages.message_id
          FROM messages
          WHERE messages.thread_id = threads.id
          ORDER BY COALESCE(messages.sent_at, messages.received_at, messages.created_at) DESC
          LIMIT 1
        ) as latestMessageId
      FROM threads
      WHERE threads.id = ?
    `
    )
    .get(threadId) as {
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    latestMessageId: string | null;
  };

  const latestIsInbound =
    state.lastInboundAt !== null &&
    (!state.lastOutboundAt || state.lastInboundAt > state.lastOutboundAt);

  sqlite
    .prepare(
      `
      UPDATE threads
      SET last_message_id = ?,
          status = CASE
            WHEN ? = 1 THEN 'bounced'
            WHEN ? = 1 THEN status
            ELSE ?
          END,
          next_followup_at = CASE WHEN ? = 1 THEN NULL ELSE next_followup_at END,
          updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      state.latestMessageId ?? messageId,
      isBounce ? 1 : 0,
      nonActionableInbound ? 1 : 0,
      latestIsInbound ? "replied" : "waiting",
      latestIsInbound || isBounce ? 1 : 0,
      now,
      threadId
    );

  return { latestIsInbound };
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
  const sqlite = getSqlite();
  const alreadyLogged = sqlite
    .prepare(
      `
      SELECT id
      FROM events
      WHERE event_type = 'mail_seen_unlinked'
        AND json_valid(payload_json)
        AND json_extract(payload_json, '$.messageId') = ?
      LIMIT 1
    `
    )
    .get(messageId);

  if (alreadyLogged) {
    return;
  }

  sqlite
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

function getEmailDomain(email: string) {
  const domain = email.split("@").pop();
  return domain ? normalizeDomain(domain) : null;
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

function isDeliveryFailureMessage(
  parsed: ParsedMail,
  subject: string,
  fromEmail: string
) {
  const normalizedSubject = subject.toLowerCase();
  const normalizedFrom = fromEmail.toLowerCase();
  const autoSubmitted = String(parsed.headers.get("auto-submitted") ?? "").toLowerCase();
  const contentType = String(parsed.headers.get("content-type") ?? "").toLowerCase();

  return (
    normalizedFrom.includes("mailer-daemon") ||
    normalizedFrom.includes("postmaster") ||
    autoSubmitted.includes("auto") ||
    contentType.includes("delivery-status") ||
    normalizedSubject.includes("delivery status notification") ||
    normalizedSubject.includes("mail delivery failed") ||
    normalizedSubject.includes("undeliverable") ||
    normalizedSubject.includes("delivery failure") ||
    normalizedSubject.includes("returned mail")
  );
}

function classifyNonActionableInboundMessage(
  parsed: ParsedMail,
  subject: string,
  fromEmail: string,
  direction: "inbound" | "outbound"
) {
  if (direction !== "inbound") {
    return { nonActionable: false, reason: null };
  }

  const normalizedSubject = subject.toLowerCase();
  const normalizedFrom = fromEmail.toLowerCase();
  const fromText = parsed.from?.text.toLowerCase() ?? "";
  const listId = String(parsed.headers.get("list-id") ?? "").toLowerCase();
  const listPost = String(parsed.headers.get("list-post") ?? "").toLowerCase();
  const mailingList = `${listId} ${listPost}`;

  if (
    normalizedSubject.includes("wordpress.org thread:") ||
    normalizedSubject.includes("[wordpress.org]") ||
    mailingList.includes("wordpress.org") ||
    ((normalizedFrom.includes("wordpress.org") || fromText.includes("wordpress.org")) &&
      (normalizedSubject.includes("thread:") ||
        normalizedSubject.includes("forum") ||
        normalizedSubject.includes("topic")))
  ) {
    return { nonActionable: true, reason: "wordpress_org_thread_notification" };
  }

  return { nonActionable: false, reason: null };
}

function rawHeadersJson(parsed: ParsedMail) {
  const entries = Array.from(parsed.headers.entries()) as Array<
    [string, unknown]
  >;

  return JSON.stringify(
    entries.map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(", ") : String(value)
    ])
  );
}

function isSentMailbox(mailbox: string) {
  return mailbox.toLowerCase().includes("sent");
}

function getMessageDirection(
  mailbox: string,
  fromEmail: string
): "inbound" | "outbound" {
  if (isSentMailbox(mailbox)) {
    return "outbound";
  }

  if (fromEmail && OWNED_MAILBOX_EMAILS.has(fromEmail.toLowerCase())) {
    return "outbound";
  }

  return "inbound";
}

main().catch(async (error) => {
  console.error(error);
  await notifyWorkerFailure("mail-sync", error);
  process.exitCode = 1;
});
