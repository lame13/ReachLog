import { env } from "../../src/modules/core/env";
import { getSqlite } from "../../src/modules/core/db/client";

type CountRow = { count: number };
type CursorRow = {
  mailbox: string;
  uidValidity: number | null;
  lastUid: number;
  updatedAt: string;
};
type TargetSampleRow = {
  targetId: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  status: string;
  doNotResend: number;
  sourceType: string;
  updatedAt: string;
};
type UnlinkedEventRow = {
  id: string;
  mailbox: string;
  payloadJson: string | null;
  createdAt: string;
};
type ParsedUnlinkedEvent = UnlinkedEventRow & {
  messageId: string;
  payload: Record<string, unknown>;
};
type ContactRow = {
  targetId: string;
  companyName: string;
  email: string;
};

const sqlite = getSqlite();
const importedMessageIds = loadImportedMessageIds();
const unlinkedEvents = loadUnlinkedEvents();
const unresolvedUnlinkedEvents = unlinkedEvents.filter(
  (event) => event.messageId && !importedMessageIds.has(event.messageId)
);

console.log("Mail sync audit");
console.log(`database: ${env.DATABASE_PATH}`);
console.log(`imap enabled: ${String(env.IMAP_ENABLED)}`);
console.log(`mailboxes: ${env.IMAP_MAILBOXES}`);
console.log(`lookback days: ${env.IMAP_LOOKBACK_DAYS}`);
console.log("");

printCounts();
printPendingMailResyncJobs();
printCursors();
printMailboxMessageCounts();
printMissingTargetSamples();
printUnlinkedMailSummary();

function printCounts() {
  const counts = {
    totalTargets: scalar("SELECT COUNT(*) as count FROM targets"),
    emailTargets: scalar(
      `
      SELECT COUNT(*) as count
      FROM targets
      INNER JOIN contacts ON contacts.id = targets.contact_id
      WHERE contacts.email IS NOT NULL
        AND contacts.email <> ''
    `
    ),
    targetsWithMessages: scalar(
      `
      SELECT COUNT(DISTINCT threads.target_id) as count
      FROM threads
      INNER JOIN messages ON messages.thread_id = threads.id
    `
    ),
    targetsWithOutbound: scalar(
      `
      SELECT COUNT(DISTINCT threads.target_id) as count
      FROM threads
      INNER JOIN messages ON messages.thread_id = threads.id
      WHERE messages.direction = 'outbound'
    `
    ),
    targetsWithInbound: scalar(
      `
      SELECT COUNT(DISTINCT threads.target_id) as count
      FROM threads
      INNER JOIN messages ON messages.thread_id = threads.id
      WHERE messages.direction = 'inbound'
    `
    ),
    emailTargetsWithoutMessages: scalar(
      `
      SELECT COUNT(*) as count
      FROM targets
      INNER JOIN contacts ON contacts.id = targets.contact_id
      WHERE contacts.email IS NOT NULL
        AND contacts.email <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM threads
          INNER JOIN messages ON messages.thread_id = threads.id
          WHERE threads.target_id = targets.id
        )
    `
    ),
    emailTargetsWithoutOutbound: scalar(
      `
      SELECT COUNT(*) as count
      FROM targets
      INNER JOIN contacts ON contacts.id = targets.contact_id
      WHERE contacts.email IS NOT NULL
        AND contacts.email <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM threads
          INNER JOIN messages ON messages.thread_id = threads.id
          WHERE threads.target_id = targets.id
            AND messages.direction = 'outbound'
        )
    `
    ),
    messages: scalar("SELECT COUNT(*) as count FROM messages"),
    threads: scalar("SELECT COUNT(*) as count FROM threads"),
    unlinkedMailEvents: scalar(
      "SELECT COUNT(*) as count FROM events WHERE event_type = 'mail_seen_unlinked'"
    ),
    unresolvedUnlinkedMailEvents: unresolvedUnlinkedEvents.length
  };

  console.log("Counts");
  for (const [key, value] of Object.entries(counts)) {
    console.log(`${key}: ${value}`);
  }
  console.log("");
}

function printPendingMailResyncJobs() {
  const rows = sqlite
    .prepare(
      `
      SELECT
        id,
        payload_json as payloadJson,
        run_at as runAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM jobs
      WHERE type = 'mail_resync'
        AND status = 'pending'
      ORDER BY created_at ASC
    `
    )
    .all() as Array<{
    id: string;
    payloadJson: string | null;
    runAt: string;
    createdAt: string;
    updatedAt: string;
  }>;

  console.log("Pending mail resync jobs");

  if (!rows.length) {
    console.log("none");
    console.log("");
    return;
  }

  for (const row of rows) {
    const payload = parsePayload(row.payloadJson);
    console.log(
      `${row.id}: days=${payload.days ?? "?"} reasons=${Array.isArray(payload.reasons) ? payload.reasons.join(",") : ""} runAt=${row.runAt}`
    );
  }

  console.log("");
}

function printCursors() {
  const rows = sqlite
    .prepare(
      `
      SELECT
        mailbox,
        uid_validity as uidValidity,
        last_uid as lastUid,
        updated_at as updatedAt
      FROM mailbox_cursors
      ORDER BY mailbox ASC
    `
    )
    .all() as CursorRow[];

  console.log("Mailbox cursors");

  if (!rows.length) {
    console.log("none");
    console.log("");
    return;
  }

  for (const row of rows) {
    console.log(
      `${row.mailbox}: lastUid=${row.lastUid} uidValidity=${row.uidValidity ?? "null"} updated=${row.updatedAt}`
    );
  }
  console.log("");
}

function printMailboxMessageCounts() {
  const rows = sqlite
    .prepare(
      `
      SELECT
        threads.mailbox,
        messages.direction,
        COUNT(*) as messages,
        COUNT(DISTINCT threads.target_id) as targets
      FROM messages
      INNER JOIN threads ON threads.id = messages.thread_id
      GROUP BY threads.mailbox, messages.direction
      ORDER BY threads.mailbox ASC, messages.direction ASC
    `
    )
    .all() as Array<{
    mailbox: string;
    direction: string;
    messages: number;
    targets: number;
  }>;

  console.log("Imported messages by mailbox");

  if (!rows.length) {
    console.log("none");
    console.log("");
    return;
  }

  for (const row of rows) {
    console.log(
      `${row.mailbox} ${row.direction}: messages=${row.messages} targets=${row.targets}`
    );
  }
  console.log("");
}

function printMissingTargetSamples() {
  const rows = sqlite
    .prepare(
      `
      SELECT
        targets.id as targetId,
        targets.company_name as companyName,
        contacts.name as contactName,
        contacts.email,
        targets.status,
        targets.do_not_resend as doNotResend,
        targets.source_type as sourceType,
        targets.updated_at as updatedAt
      FROM targets
      INNER JOIN contacts ON contacts.id = targets.contact_id
      WHERE contacts.email IS NOT NULL
        AND contacts.email <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM threads
          INNER JOIN messages ON messages.thread_id = threads.id
          WHERE threads.target_id = targets.id
        )
      ORDER BY targets.updated_at DESC
      LIMIT 25
    `
    )
    .all() as TargetSampleRow[];

  console.log("Sample email targets with zero imported messages");

  if (!rows.length) {
    console.log("none");
    console.log("");
    return;
  }

  for (const row of rows) {
    console.log(
      `${row.targetId} | ${row.companyName} | ${row.contactName ?? ""} | ${row.email ?? ""} | ${row.status} | source=${row.sourceType} | dnr=${row.doNotResend}`
    );
  }
  console.log("");
}

function printUnlinkedMailSummary() {
  const byMailbox = countUnresolvedUnlinkedByMailbox();
  const contacts = sqlite
    .prepare(
      `
      SELECT
        targets.id as targetId,
        targets.company_name as companyName,
        contacts.email
      FROM targets
      INNER JOIN contacts ON contacts.id = targets.contact_id
      WHERE contacts.email IS NOT NULL
        AND contacts.email <> ''
    `
    )
    .all() as ContactRow[];
  const exactMatches: string[] = [];

  for (const event of unresolvedUnlinkedEvents) {
    const payload = event.payload;
    const text = `${payload.from ?? ""} ${payload.to ?? ""}`.toLowerCase();

    if (!text) {
      continue;
    }

    const match = contacts.find((contact) => text.includes(contact.email.toLowerCase()));

    if (match) {
      exactMatches.push(
        `${event.createdAt} | ${event.mailbox} | ${match.companyName} | ${match.email} | ${payload.subject ?? ""}`
      );

      if (exactMatches.length >= 25) {
        break;
      }
    }
  }

  console.log("Unresolved unlinked mail events by mailbox");

  if (!byMailbox.length) {
    console.log("none");
  } else {
    for (const row of byMailbox) {
      console.log(`${row.mailbox}: ${row.count}`);
    }
  }

  console.log("");
  console.log("Sample unresolved unlinked events that now match a known contact email");

  if (!exactMatches.length) {
    console.log("none");
  } else {
    for (const line of exactMatches) {
      console.log(line);
    }
  }

  console.log("");
}

function scalar(query: string) {
  return (sqlite.prepare(query).get() as CountRow).count;
}

function loadImportedMessageIds() {
  const rows = sqlite
    .prepare("SELECT message_id as messageId FROM messages")
    .all() as Array<{ messageId: string }>;

  return new Set(rows.map((row) => row.messageId));
}

function loadUnlinkedEvents() {
  const rows = sqlite
    .prepare(
      `
      SELECT
        id,
        entity_id as mailbox,
        payload_json as payloadJson,
        created_at as createdAt
      FROM events
      WHERE event_type = 'mail_seen_unlinked'
      ORDER BY created_at DESC
    `
    )
    .all() as UnlinkedEventRow[];

  return rows.map((row): ParsedUnlinkedEvent => {
    const payload = parsePayload(row.payloadJson);

    return {
      ...row,
      messageId: normalizeString(payload.messageId),
      payload
    };
  });
}

function countUnresolvedUnlinkedByMailbox() {
  const counts = new Map<string, number>();

  for (const event of unresolvedUnlinkedEvents) {
    counts.set(event.mailbox, (counts.get(event.mailbox) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([mailbox, count]) => ({ mailbox, count }))
    .sort((a, b) => b.count - a.count);
}

function parsePayload(value: string | null) {
  if (!value) {
    return {} as Record<string, unknown>;
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value : "";
}
