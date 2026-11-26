import { getSqlite } from "@/modules/core/db/client";

type AccountRecord = {
  id: string;
  name: string;
  domain: string | null;
  websiteUrl: string | null;
  notes: string | null;
  contactCount: number;
  targetCount: number;
  createdAt: string;
};

type ContactRecord = {
  id: string;
  accountId: string | null;
  accountName: string | null;
  name: string;
  email: string;
  domain: string;
  title: string | null;
  tags: string | null;
  notes: string | null;
  targetCount: number;
  createdAt: string;
};

export type DuplicateAccount = {
  keep: AccountRecord;
  merge: AccountRecord;
  reason: string;
};

export type DuplicateContact = {
  keep: ContactRecord;
  merge: ContactRecord;
  reason: string;
};

export function getDuplicateSuggestions() {
  const sqlite = getSqlite();
  const accounts = sqlite
    .prepare(
      `
      SELECT
        accounts.id,
        accounts.name,
        accounts.domain,
        accounts.website_url as websiteUrl,
        accounts.notes,
        accounts.created_at as createdAt,
        (SELECT COUNT(*) FROM contacts WHERE contacts.account_id = accounts.id) as contactCount,
        (SELECT COUNT(*) FROM targets WHERE targets.account_id = accounts.id) as targetCount
      FROM accounts
      ORDER BY accounts.created_at ASC, accounts.id ASC
    `
    )
    .all() as AccountRecord[];
  const contacts = sqlite
    .prepare(
      `
      SELECT
        contacts.id,
        contacts.account_id as accountId,
        accounts.name as accountName,
        contacts.name,
        contacts.email,
        contacts.domain,
        contacts.title,
        contacts.tags,
        contacts.notes,
        contacts.created_at as createdAt,
        (SELECT COUNT(*) FROM targets WHERE targets.contact_id = contacts.id) as targetCount
      FROM contacts
      LEFT JOIN accounts ON accounts.id = contacts.account_id
      ORDER BY contacts.created_at ASC, contacts.id ASC
    `
    )
    .all() as ContactRecord[];

  return {
    accounts: buildAccountSuggestions(accounts),
    contacts: buildContactSuggestions(contacts)
  };
}

export function getDuplicateSuggestionCount() {
  const suggestions = getDuplicateSuggestions();
  return suggestions.accounts.length + suggestions.contacts.length;
}

function buildAccountSuggestions(records: AccountRecord[]) {
  const groups = groupBy(records, (record) => normalizeCompanyName(record.name));
  const suggestions: DuplicateAccount[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        right.targetCount + right.contactCount -
          (left.targetCount + left.contactCount) ||
        left.id.localeCompare(right.id)
    );
    const [keep, ...rest] = group;

    for (const merge of rest) {
      suggestions.push({
        keep,
        merge,
        reason:
          keep.domain && merge.domain
            ? "The company names match but the records use different domains."
            : "The company names match after normalization."
      });
    }
  }

  return suggestions;
}

function buildContactSuggestions(records: ContactRecord[]) {
  const groups = groupBy(
    records,
    (record) => {
      const name = normalizePersonName(record.name);
      const scope = record.accountId ? `account:${record.accountId}` : `domain:${record.domain}`;
      return name && (record.accountId || (record.domain && record.domain !== "unknown"))
        ? `${scope}|${name}`
        : "";
    }
  );
  const suggestions: DuplicateContact[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        right.targetCount - left.targetCount ||
        left.id.localeCompare(right.id)
    );
    const [keep, ...rest] = group;

    for (const merge of rest) {
      suggestions.push({
        keep,
        merge,
        reason: keep.accountId
          ? "These contacts have the same name in the same account."
          : "These contacts have the same name and email domain."
      });
    }
  }

  return suggestions;
}

function groupBy<T>(records: T[], keyFor: (record: T) => string) {
  const groups = new Map<string, T[]>();

  for (const record of records) {
    const key = keyFor(record);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  return groups;
}

function normalizeCompanyName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(
      /\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|gmbh|pte)\b/g,
      " "
    )
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

function normalizePersonName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}
