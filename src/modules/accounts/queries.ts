import { getSqlite } from "@/modules/core/db/client";
import { getTimeline, type TimelineItem } from "@/modules/timeline/events";

export type AccountFilters = {
  q?: string;
  stage?: string;
};

export type AccountListRow = {
  id: string;
  name: string;
  domain: string | null;
  websiteUrl: string | null;
  notes: string | null;
  contactCount: number;
  targetCount: number;
  openTargetCount: number;
  wonTargetCount: number;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccountDetail = {
  account: AccountListRow;
  contacts: Array<{
    id: string;
    name: string;
    email: string;
    title: string | null;
    tags: string | null;
    emailVerificationStatus: string | null;
    targetCount: number;
  }>;
  targets: Array<{
    id: string;
    companyName: string;
    status: string;
    stage: string;
    doNotResend: number;
    contactName: string | null;
    contactEmail: string | null;
    updatedAt: string;
  }>;
  messages: Array<{
    id: string;
    targetId: string;
    companyName: string;
    direction: string;
    subject: string;
    fromEmail: string;
    at: string | null;
    bodyText: string | null;
  }>;
  timeline: TimelineItem[];
};

export function getAccounts(filters: AccountFilters = {}) {
  const rows = getSqlite()
    .prepare(
      `
      SELECT
        accounts.id,
        accounts.name,
        accounts.domain,
        accounts.website_url as websiteUrl,
        accounts.notes,
        accounts.created_at as createdAt,
        accounts.updated_at as updatedAt,
        (SELECT COUNT(*) FROM contacts WHERE contacts.account_id = accounts.id) as contactCount,
        (SELECT COUNT(*) FROM targets WHERE targets.account_id = accounts.id) as targetCount,
        (
          SELECT COUNT(*) FROM targets
          WHERE targets.account_id = accounts.id
            AND targets.stage NOT IN ('won', 'lost')
        ) as openTargetCount,
        (
          SELECT COUNT(*) FROM targets
          WHERE targets.account_id = accounts.id
            AND targets.stage = 'won'
        ) as wonTargetCount,
        MAX(accounts.updated_at, COALESCE((
          SELECT MAX(activity.at)
          FROM (
            SELECT MAX(targets.updated_at, COALESCE(threads.last_inbound_at, ''), COALESCE(threads.last_outbound_at, '')) as at
            FROM targets
            LEFT JOIN threads ON threads.target_id = targets.id
            WHERE targets.account_id = accounts.id
            UNION ALL
            SELECT events.created_at as at
            FROM events
            WHERE (events.entity_type = 'account' AND events.entity_id = accounts.id)
              OR (events.entity_type = 'target' AND events.entity_id IN (
                SELECT id FROM targets WHERE account_id = accounts.id
              ))
          ) activity
        ), '')) as lastActivityAt
      FROM accounts
      ORDER BY accounts.name COLLATE NOCASE ASC
    `
    )
    .all() as AccountListRow[];

  const query = filters.q?.trim().toLowerCase();
  const stage = filters.stage?.trim();

  return rows.filter((account) => {
    if (
      query &&
      ![account.name, account.domain, account.websiteUrl, account.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    ) {
      return false;
    }

    if (stage === "won" && !account.wonTargetCount) {
      return false;
    }

    if (stage === "open" && !account.openTargetCount) {
      return false;
    }

    return true;
  });
}

export function getAccountOptions() {
  return getSqlite()
    .prepare("SELECT id, name FROM accounts ORDER BY name COLLATE NOCASE ASC")
    .all() as Array<{ id: string; name: string }>;
}

export function getAccountDetail(id: string): AccountDetail | null {
  const sqlite = getSqlite();
  const account = getAccounts().find((row) => row.id === id);

  if (!account) {
    return null;
  }

  const accountContacts = sqlite
    .prepare(
      `
      SELECT
        contacts.id,
        contacts.name,
        contacts.email,
        contacts.title,
        contacts.tags,
        contacts.email_verification_status as emailVerificationStatus,
        (SELECT COUNT(*) FROM targets WHERE targets.contact_id = contacts.id) as targetCount
      FROM contacts
      WHERE contacts.account_id = ?
      ORDER BY contacts.name COLLATE NOCASE ASC
    `
    )
    .all(id) as AccountDetail["contacts"];

  const accountTargets = sqlite
    .prepare(
      `
      SELECT
        targets.id,
        targets.company_name as companyName,
        targets.status,
        targets.stage,
        targets.do_not_resend as doNotResend,
        contacts.name as contactName,
        contacts.email as contactEmail,
        targets.updated_at as updatedAt
      FROM targets
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      WHERE targets.account_id = ?
      ORDER BY targets.updated_at DESC
    `
    )
    .all(id) as AccountDetail["targets"];

  const targetIds = accountTargets.map((target) => target.id);
  const messages = targetIds.length
    ? (sqlite
        .prepare(
          `
          SELECT
            messages.id,
            targets.id as targetId,
            targets.company_name as companyName,
            messages.direction,
            messages.subject,
            messages.from_email as fromEmail,
            COALESCE(messages.sent_at, messages.received_at, messages.created_at) as at,
            messages.body_text as bodyText
          FROM messages
          INNER JOIN threads ON threads.id = messages.thread_id
          INNER JOIN targets ON targets.id = threads.target_id
          WHERE threads.target_id IN (${targetIds.map(() => "?").join(", ")})
          ORDER BY at DESC
          LIMIT 20
        `
        )
        .all(...targetIds) as AccountDetail["messages"])
    : [];

  return {
    account,
    contacts: accountContacts,
    targets: accountTargets,
    messages,
    timeline: getTimeline({ accountId: id, targetIds })
  };
}

export function getAccountForContact(contactId: string) {
  const row = getSqlite()
    .prepare(
      `
      SELECT accounts.id, accounts.name
      FROM contacts
      INNER JOIN accounts ON accounts.id = contacts.account_id
      WHERE contacts.id = ?
    `
    )
    .get(contactId) as { id: string; name: string } | undefined;

  return row ?? null;
}
