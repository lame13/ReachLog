import { getSqlite } from "../../src/modules/core/db/client";
import { parseSourceTimestampFromValues } from "../../src/modules/outreach/historical-timestamps";

type EventRow = {
  id: string;
  entityId: string;
  eventType: string;
  payloadJson: string | null;
  createdAt: string;
};

type TargetRow = {
  id: string;
  contactId: string | null;
  createdAt: string;
  updatedAt: string;
};

type ContactFormRow = {
  id: string;
  targetId: string;
  messageText: string | null;
  notes: string | null;
  submittedAt: string;
};

type ContactRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
};

const sqlite = getSqlite();
const sourceByTargetId = new Map<string, string>();
let eventPayloadsUpdated = 0;
let eventDatesUpdated = 0;
let contactFormsUpdated = 0;
let targetsUpdated = 0;
let contactsUpdated = 0;

const events = sqlite
  .prepare(
    `
    SELECT
      id,
      entity_id as entityId,
      event_type as eventType,
      payload_json as payloadJson,
      created_at as createdAt
    FROM events
  `
  )
  .all() as EventRow[];

const transaction = sqlite.transaction(() => {
  for (const event of events) {
    if (!event.payloadJson) {
      continue;
    }

    const payload = parsePayload(event.payloadJson);

    if (!payload) {
      continue;
    }

    const sourceTimestamp =
      normalizeString(payload.sourceTimestamp) ||
      parseSourceTimestampFromValues(
        normalizeString(payload.dateSent),
        normalizeString(payload.datePosted),
        normalizeString(payload.dateUpdated),
        normalizeString(payload.dateRecorded),
        normalizeString(payload.messageText),
        normalizeString(payload.notes),
        normalizeString(payload.subject)
      );

    if (!sourceTimestamp) {
      continue;
    }

    setEarliestSource(sourceByTargetId, event.entityId, sourceTimestamp);

    if (!payload.sourceTimestamp) {
      payload.sourceTimestamp = sourceTimestamp;
      sqlite
        .prepare("UPDATE events SET payload_json = ? WHERE id = ?")
        .run(JSON.stringify(payload), event.id);
      eventPayloadsUpdated += 1;
    }

    if (
      (event.eventType === "outreach_logged" || event.eventType === "form_submitted") &&
      event.createdAt !== sourceTimestamp
    ) {
      sqlite
        .prepare("UPDATE events SET created_at = ? WHERE id = ?")
        .run(sourceTimestamp, event.id);
      eventDatesUpdated += 1;
    }
  }

  const forms = sqlite
    .prepare(
      `
      SELECT
        id,
        target_id as targetId,
        message_text as messageText,
        notes,
        submitted_at as submittedAt
      FROM contact_form_submissions
    `
    )
    .all() as ContactFormRow[];

  for (const form of forms) {
    const sourceTimestamp = parseSourceTimestampFromValues(form.messageText, form.notes);

    if (!sourceTimestamp) {
      continue;
    }

    setEarliestSource(sourceByTargetId, form.targetId, sourceTimestamp);

    if (form.submittedAt !== sourceTimestamp) {
      sqlite
        .prepare("UPDATE contact_form_submissions SET submitted_at = ? WHERE id = ?")
        .run(sourceTimestamp, form.id);
      contactFormsUpdated += 1;
    }
  }

  const targetRows = sqlite
    .prepare(
      `
      SELECT
        id,
        contact_id as contactId,
        created_at as createdAt,
        updated_at as updatedAt
      FROM targets
    `
    )
    .all() as TargetRow[];

  const contactSourceById = new Map<string, string>();

  for (const target of targetRows) {
    const sourceTimestamp = sourceByTargetId.get(target.id);

    if (!sourceTimestamp) {
      continue;
    }

    if (target.contactId) {
      setEarliestSource(contactSourceById, target.contactId, sourceTimestamp);
    }

    if (target.createdAt === sourceTimestamp) {
      continue;
    }

    const nextUpdatedAt = target.updatedAt === target.createdAt ? sourceTimestamp : target.updatedAt;
    sqlite
      .prepare("UPDATE targets SET created_at = ?, updated_at = ? WHERE id = ?")
      .run(sourceTimestamp, nextUpdatedAt, target.id);
    targetsUpdated += 1;
  }

  for (const [contactId, sourceTimestamp] of contactSourceById.entries()) {
    const contact = sqlite
      .prepare(
        "SELECT id, created_at as createdAt, updated_at as updatedAt FROM contacts WHERE id = ?"
      )
      .get(contactId) as ContactRow | undefined;

    if (!contact || contact.createdAt === sourceTimestamp) {
      continue;
    }

    const nextUpdatedAt =
      contact.updatedAt === contact.createdAt ? sourceTimestamp : contact.updatedAt;
    sqlite
      .prepare("UPDATE contacts SET created_at = ?, updated_at = ? WHERE id = ?")
      .run(sourceTimestamp, nextUpdatedAt, contactId);
    contactsUpdated += 1;
  }
});

transaction();

console.log("Backfilled source timestamps.");
console.log(`events payloads updated: ${eventPayloadsUpdated}`);
console.log(`event dates updated: ${eventDatesUpdated}`);
console.log(`contact forms updated: ${contactFormsUpdated}`);
console.log(`targets updated: ${targetsUpdated}`);
console.log(`contacts updated: ${contactsUpdated}`);

function parsePayload(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function setEarliestSource(map: Map<string, string>, id: string, sourceTimestamp: string) {
  const existing = map.get(id);

  if (!existing || sourceTimestamp < existing) {
    map.set(id, sourceTimestamp);
  }
}
