"use server";

import { revalidatePath } from "next/cache";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import { recordEvent } from "@/modules/timeline/record";
import { normalizeContactRole } from "./contacts";

export async function addOpportunityContactAction(formData: FormData) {
  const targetId = clean(formData.get("targetId"));
  const contactId = clean(formData.get("contactId"));
  const role = normalizeContactRole(clean(formData.get("role")));

  if (!targetId || !contactId) {
    return;
  }

  const sqlite = getSqlite();
  const target = sqlite
    .prepare("SELECT contact_id as primaryContactId FROM targets WHERE id = ?")
    .get(targetId) as { primaryContactId: string | null } | undefined;
  const contact = sqlite
    .prepare("SELECT id FROM contacts WHERE id = ?")
    .get(contactId) as { id: string } | undefined;

  if (!target || !contact || target.primaryContactId === contactId) {
    return;
  }

  const now = new Date().toISOString();
  sqlite
    .prepare(
      `
      INSERT INTO target_contacts (
        id, target_id, contact_id, role, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_id, contact_id)
      DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at
    `
    )
    .run(createId("target_contact"), targetId, contactId, role, now, now);

  recordEvent({
    entityType: "target",
    entityId: targetId,
    eventType: "opportunity_contact_added",
    payload: { contactId, role }
  });
  recordEvent({
    entityType: "contact",
    entityId: contactId,
    eventType: "opportunity_role_added",
    payload: { targetId, role }
  });
  revalidateContactRolePaths(targetId, contactId);
}

export async function removeOpportunityContactAction(formData: FormData) {
  const id = clean(formData.get("id"));
  const targetId = clean(formData.get("targetId"));

  if (!id || !targetId) {
    return;
  }

  const sqlite = getSqlite();
  const row = sqlite
    .prepare(
      "SELECT contact_id as contactId, role FROM target_contacts WHERE id = ? AND target_id = ?"
    )
    .get(id, targetId) as { contactId: string; role: string } | undefined;

  if (!row) {
    return;
  }

  sqlite
    .prepare("DELETE FROM target_contacts WHERE id = ? AND target_id = ?")
    .run(id, targetId);
  recordEvent({
    entityType: "target",
    entityId: targetId,
    eventType: "opportunity_contact_removed",
    payload: { contactId: row.contactId, role: row.role }
  });
  revalidateContactRolePaths(targetId, row.contactId);
}

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function revalidateContactRolePaths(targetId: string, contactId: string) {
  revalidatePath(`/targets/${targetId}`);
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
}
