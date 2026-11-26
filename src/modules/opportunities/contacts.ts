import { getSqlite } from "@/modules/core/db/client";

export const contactRoleOptions = [
  "Decision maker",
  "Champion",
  "User",
  "Finance",
  "Blocker",
  "Stakeholder"
] as const;

export type ContactRole = (typeof contactRoleOptions)[number];

export type AdditionalOpportunityContact = {
  id: string;
  contactId: string;
  name: string;
  email: string;
  title: string | null;
  role: string;
};

export function getTargetAdditionalContacts(
  targetId: string
): AdditionalOpportunityContact[] {
  return getSqlite()
    .prepare(
      `
      SELECT
        target_contacts.id,
        contacts.id as contactId,
        contacts.name,
        contacts.email,
        contacts.title,
        target_contacts.role
      FROM target_contacts
      INNER JOIN contacts ON contacts.id = target_contacts.contact_id
      WHERE target_contacts.target_id = ?
      ORDER BY contacts.name COLLATE NOCASE ASC, contacts.email ASC
    `
    )
    .all(targetId) as AdditionalOpportunityContact[];
}

export function getAvailableContactsForTarget(targetId: string) {
  return getSqlite()
    .prepare(
      `
      SELECT contacts.id, contacts.name, contacts.email
      FROM contacts
      INNER JOIN targets ON targets.id = ?
      WHERE contacts.id <> COALESCE(targets.contact_id, '')
        AND NOT EXISTS (
          SELECT 1
          FROM target_contacts
          WHERE target_contacts.target_id = targets.id
            AND target_contacts.contact_id = contacts.id
        )
      ORDER BY contacts.name COLLATE NOCASE ASC, contacts.email ASC
      LIMIT 200
    `
    )
    .all(targetId) as Array<{ id: string; name: string; email: string }>;
}

export function getContactOpportunityRoles(contactId: string) {
  return getSqlite()
    .prepare(
      `
      SELECT
        target_contacts.target_id as targetId,
        targets.company_name as companyName,
        targets.stage,
        target_contacts.role
      FROM target_contacts
      INNER JOIN targets ON targets.id = target_contacts.target_id
      WHERE target_contacts.contact_id = ?
      ORDER BY targets.updated_at DESC
    `
    )
    .all(contactId) as Array<{
    targetId: string;
    companyName: string;
    stage: string;
    role: string;
  }>;
}

export function normalizeContactRole(value: string): ContactRole {
  return contactRoleOptions.includes(value as ContactRole)
    ? (value as ContactRole)
    : "Stakeholder";
}
