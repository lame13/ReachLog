import { getSqlite } from "../../src/modules/core/db/client";

type EventRow = {
  id: string;
  eventType: string;
  payloadJson: string | null;
  createdAt: string;
};

type MessageRow = {
  messageDate: string | null;
};

const mailEventTypes = [
  "email_sent",
  "reply_received",
  "email_received",
  "email_bounced",
  "bounced",
  "mail_notification_received"
];

const sqlite = getSqlite();
let eventDatesUpdated = 0;
let payloadsUpdated = 0;
let missingMessageIds = 0;
let missingMessages = 0;

const events = sqlite
  .prepare(
    `
    SELECT
      id,
      event_type as eventType,
      payload_json as payloadJson,
      created_at as createdAt
    FROM events
    WHERE event_type IN (${mailEventTypes.map(() => "?").join(", ")})
  `
  )
  .all(...mailEventTypes) as EventRow[];

const findMessage = sqlite.prepare(
  `
  SELECT COALESCE(sent_at, received_at, created_at) as messageDate
  FROM messages
  WHERE message_id = ?
`
);

const transaction = sqlite.transaction(() => {
  for (const event of events) {
    const payload = parsePayload(event.payloadJson);
    const messageId = normalizeString(payload?.messageId);

    if (!messageId) {
      missingMessageIds += 1;
      continue;
    }

    const message = findMessage.get(messageId) as MessageRow | undefined;
    const messageDate = message?.messageDate;

    if (!messageDate) {
      missingMessages += 1;
      continue;
    }

    if (payload && !payload.messageDate) {
      payload.messageDate = messageDate;
      payload.syncedAt = payload.syncedAt ?? event.createdAt;
      sqlite
        .prepare("UPDATE events SET payload_json = ? WHERE id = ?")
        .run(JSON.stringify(payload), event.id);
      payloadsUpdated += 1;
    }

    if (event.createdAt !== messageDate) {
      sqlite
        .prepare("UPDATE events SET created_at = ? WHERE id = ?")
        .run(messageDate, event.id);
      eventDatesUpdated += 1;
    }
  }
});

transaction();

console.log("Backfilled mail event timestamps.");
console.log(`events scanned: ${events.length}`);
console.log(`event dates updated: ${eventDatesUpdated}`);
console.log(`payloads updated: ${payloadsUpdated}`);
console.log(`events missing messageId: ${missingMessageIds}`);
console.log(`events with missing message row: ${missingMessages}`);

function parsePayload(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value : "";
}
