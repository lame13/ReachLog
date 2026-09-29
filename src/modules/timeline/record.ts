import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";

/**
 * One place to append to the activity log, so accounts, contacts, targets and
 * the pipeline all write timeline entries the same way.
 */
export function recordEvent({
  entityType,
  entityId,
  eventType,
  payload = {}
}: {
  entityType: "account" | "contact" | "target";
  entityId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  getSqlite()
    .prepare(
      `
      INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      createId("event"),
      entityType,
      entityId,
      eventType,
      JSON.stringify(payload),
      new Date().toISOString()
    );
}
