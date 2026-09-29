import { getSqlite } from "@/modules/core/db/client";
import { getTimeline, type TimelineItem } from "@/modules/timeline/events";

export type ContactFilters = {
  q?: string;
  domain?: string;
  accountId?: string;
  contactId?: string;
  tag?: string;
};

export type ContactListRow = {
  id: string;
  name: string;
  email: string;
  domain: string;
  title: string | null;
  phone: string | null;
  linksJson: string | null;
  tags: string | null;
  notes: string | null;
  accountId: string | null;
  accountName: string | null;
  emailVerificationStatus: string | null;
  emailVerificationProvider: string | null;
  emailVerificationCheckedAt: string | null;
  emailVerificationError: string | null;
  targetCount: number;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactDetail = {
  contact: ContactListRow;
  targets: Array<{
    id: string;
    companyName: string;
    status: string;
    stage: string;
    doNotResend: number;
    sourceType: string;
    updatedAt: string;
  }>;
  forms: Array<{
    id: string;
    targetId: string;
    formUrl: string;
    messageText: string;
    submittedAt: string;
  }>;
  timeline: TimelineItem[];
};

export function getContacts(filters: ContactFilters = {}) {
  const rows = getSqlite()
    .prepare(
      `
      SELECT
        contacts.id,
        contacts.name,
        contacts.email,
        contacts.domain,
        contacts.title,
        contacts.phone,
        contacts.links_json as linksJson,
        contacts.tags,
        contacts.notes,
        contacts.account_id as accountId,
        accounts.name as accountName,
        contacts.email_verification_status as emailVerificationStatus,
        contacts.email_verification_provider as emailVerificationProvider,
        contacts.email_verification_checked_at as emailVerificationCheckedAt,
        contacts.email_verification_error as emailVerificationError,
        contacts.created_at as createdAt,
        contacts.updated_at as updatedAt,
        (SELECT COUNT(*) FROM targets WHERE targets.contact_id = contacts.id) as targetCount,
        MAX(contacts.updated_at, COALESCE((
          SELECT MAX(activity.at)
          FROM (
            SELECT MAX(targets.updated_at, COALESCE(threads.last_inbound_at, ''), COALESCE(threads.last_outbound_at, '')) as at
            FROM targets
            LEFT JOIN threads ON threads.target_id = targets.id
            WHERE targets.contact_id = contacts.id
            UNION ALL
            SELECT events.created_at as at
            FROM events
            WHERE (events.entity_type = 'contact' AND events.entity_id = contacts.id)
              OR (events.entity_type = 'target' AND events.entity_id IN (
                SELECT id FROM targets WHERE contact_id = contacts.id
              ))
          ) activity
        ), '')) as lastActivityAt
      FROM contacts
      LEFT JOIN accounts ON accounts.id = contacts.account_id
      ORDER BY contacts.name COLLATE NOCASE ASC, contacts.email ASC
    `
    )
    .all() as ContactListRow[];

  const query = filters.q?.trim().toLowerCase();
  const domain = filters.domain?.trim().toLowerCase();
  const accountId = filters.accountId?.trim();
  const tag = filters.tag?.trim().toLowerCase();

  return rows.filter((contact) => {
    if (filters.contactId && contact.id !== filters.contactId) {
      return false;
    }

    if (
      query &&
      ![
        contact.name,
        contact.email,
        contact.domain,
        contact.title,
        contact.phone,
        contact.tags,
        contact.notes,
        contact.accountName
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    ) {
      return false;
    }

    if (domain && contact.domain.toLowerCase() !== domain) {
      return false;
    }

    if (accountId && contact.accountId !== accountId) {
      return false;
    }

    if (tag && !parseTags(contact.tags).includes(tag)) {
      return false;
    }

    return true;
  });
}

export function getContactFilterOptions() {
  const contacts = getContacts();
  const unique = (values: Array<string | null>) =>
    Array.from(new Set(values.filter(Boolean) as string[])).sort();

  return {
    domains: unique(contacts.map((contact) => contact.domain)),
    tags: unique(contacts.flatMap((contact) => parseTags(contact.tags)))
  };
}

export function getContactDetail(id: string): ContactDetail | null {
  const sqlite = getSqlite();
  const contact = getContacts().find((row) => row.id === id);

  if (!contact) {
    return null;
  }

  const contactTargets = sqlite
    .prepare(
      `
      SELECT
        targets.id,
        targets.company_name as companyName,
        targets.status,
        targets.stage,
        targets.do_not_resend as doNotResend,
        targets.source_type as sourceType,
        targets.updated_at as updatedAt
      FROM targets
      WHERE targets.contact_id = ?
      ORDER BY targets.updated_at DESC
    `
    )
    .all(id) as ContactDetail["targets"];

  const targetIds = contactTargets.map((target) => target.id);
  const forms = targetIds.length
    ? (sqlite
        .prepare(
          `
          SELECT
            contact_form_submissions.id,
            contact_form_submissions.target_id as targetId,
            contact_form_submissions.form_url as formUrl,
            contact_form_submissions.message_text as messageText,
            contact_form_submissions.submitted_at as submittedAt
          FROM contact_form_submissions
          WHERE contact_form_submissions.target_id IN (${targetIds
            .map(() => "?")
            .join(", ")})
          ORDER BY contact_form_submissions.submitted_at DESC
        `
        )
        .all(...targetIds) as ContactDetail["forms"])
    : [];

  return {
    contact,
    targets: contactTargets,
    forms,
    timeline: getTimeline({ contactId: id, targetIds })
  };
}

/**
 * Tags are a comma-separated field so the existing CSV export stays one column.
 * Matching is case-insensitive and ignores empty entries.
 */
export function parseTags(value: string | null | undefined) {
  return (value ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export function parseLinksText(value: string | null | undefined) {
  return (value ?? "")
    .split(/[\n,]/)
    .map((link) => link.trim())
    .filter(Boolean);
}

export function parseStoredLinks(linksJson: string | null | undefined) {
  if (!linksJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(linksJson);

    return Array.isArray(parsed)
      ? parsed.filter((link): link is string => typeof link === "string")
      : [];
  } catch {
    return [];
  }
}

export function serializeLinks(links: string[]) {
  return links.length ? JSON.stringify(links) : null;
}

export function getContactOptions() {
  return getSqlite()
    .prepare(
      "SELECT id, name, email FROM contacts ORDER BY name COLLATE NOCASE ASC"
    )
    .all() as Array<{ id: string; name: string; email: string }>;
}
