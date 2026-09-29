import type BetterSqlite3 from "better-sqlite3";
import { createId } from "@/modules/core/ids";
import {
  accountDedupeKey,
  accountDomainFromWebsite,
  inferAccountDomain,
  normalizeAccountDomain,
  normalizeCompanyName
} from "@/modules/accounts/dedupe";

type SqliteDatabase = BetterSqlite3.Database;

export type AccountInput = {
  sqlite: SqliteDatabase;
  name: string;
  domain?: string | null;
  websiteUrl?: string | null;
  now?: string;
};

/**
 * Finds the account a company belongs to, creating it on first contact. Both
 * the outreach forms, the CSV import and the 0.4.0 upgrade use this, so an
 * existing installation gains accounts that match its existing targets.
 */
export function findOrCreateAccount({
  sqlite,
  name,
  domain,
  websiteUrl,
  now = new Date().toISOString()
}: AccountInput) {
  const companyName = (name ?? "").trim();
  const accountDomain = accountDomainFromWebsite(websiteUrl) || normalizeAccountDomain(domain);
  const normalizedName = normalizeCompanyName(companyName);

  if (!accountDomain && !normalizedName) {
    return null;
  }

  let existing = accountDomain
    ? (sqlite
        .prepare(
          "SELECT id FROM accounts WHERE lower(domain) = ? OR dedupe_key = ? ORDER BY created_at ASC LIMIT 1"
        )
        .get(accountDomain, accountDedupeKey({ name: companyName, domain: accountDomain })) as
        | { id: string }
        | undefined)
    : (sqlite
        .prepare("SELECT id FROM accounts WHERE dedupe_key = ? LIMIT 1")
        .get(accountDedupeKey({ name: companyName })) as { id: string } | undefined);

  if (!existing && accountDomain && normalizedName) {
    existing = sqlite
      .prepare("SELECT id FROM accounts WHERE dedupe_key = ? AND COALESCE(domain, '') = '' LIMIT 1")
      .get(accountDedupeKey({ name: companyName })) as { id: string } | undefined;
  }

  if (existing) {
    // Only fill blanks: a name or website edited by hand is never overwritten
    // by the next import that happens to mention the same company.
    sqlite
      .prepare(
        `
        UPDATE accounts
        SET domain = COALESCE(NULLIF(domain, ''), ?),
            dedupe_key = CASE WHEN COALESCE(domain, '') = '' AND ? <> '' THEN ? ELSE dedupe_key END,
            website_url = COALESCE(website_url, ?),
            updated_at = MAX(updated_at, ?)
        WHERE id = ?
      `
      )
      .run(
        accountDomain || null,
        accountDomain,
        accountDedupeKey({ name: companyName, domain: accountDomain }),
        websiteUrl || null,
        now,
        existing.id
      );

    return existing.id;
  }

  const dedupeKey = accountDedupeKey({ name: companyName, domain: accountDomain });

  if (!dedupeKey) {
    return null;
  }

  const accountId = createId("account");

  sqlite
    .prepare(
      `
      INSERT INTO accounts (id, name, domain, website_url, dedupe_key, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING
    `
    )
    .run(
      accountId,
      companyName || accountDomain,
      accountDomain || null,
      websiteUrl || null,
      dedupeKey,
      now,
      now
    );

  const stored = sqlite
    .prepare("SELECT id FROM accounts WHERE dedupe_key = ? LIMIT 1")
    .get(dedupeKey) as { id: string } | undefined;

  return stored?.id ?? accountId;
}

/**
 * Upgrade path: an install that predates accounts gets one account per company
 * it already tracks, and every target and contact is linked to it. Runs once,
 * guarded by migration 0008, and never overwrites an account chosen by hand.
 */
export function backfillAccountsFromTargets(sqlite: SqliteDatabase) {
  const rows = sqlite
    .prepare(
      `
      SELECT
        targets.id,
        targets.company_name as companyName,
        targets.website_url as websiteUrl,
        targets.created_at as createdAt,
        contacts.email as contactEmail,
        contacts.domain as contactDomain
      FROM targets
      LEFT JOIN contacts ON contacts.id = targets.contact_id
      WHERE targets.account_id IS NULL
      ORDER BY targets.created_at ASC
    `
    )
    .all() as Array<{
    id: string;
    companyName: string;
    websiteUrl: string | null;
    createdAt: string;
    contactEmail: string | null;
    contactDomain: string | null;
  }>;

  if (!rows.length) {
    return { accounts: 0, linkedTargets: 0 };
  }

  const linkTarget = sqlite.prepare("UPDATE targets SET account_id = ? WHERE id = ?");
  let accounts = 0;

  for (const row of rows) {
    const domain = inferAccountDomain({
      websiteUrl: row.websiteUrl,
      contactEmail: row.contactEmail,
      sourceUrl: row.contactDomain
    });
    const existed = domain
      ? sqlite
          .prepare("SELECT id FROM accounts WHERE lower(domain) = ? LIMIT 1")
          .get(domain)
      : sqlite
          .prepare("SELECT id FROM accounts WHERE dedupe_key = ? LIMIT 1")
          .get(accountDedupeKey({ name: row.companyName }));
    const accountId = findOrCreateAccount({
      sqlite,
      name: row.companyName,
      domain,
      websiteUrl: row.websiteUrl,
      now: row.createdAt
    });

    if (!accountId) {
      continue;
    }

    if (!existed) {
      accounts += 1;
    }

    linkTarget.run(accountId, row.id);
  }

  const linkedContacts = sqlite
    .prepare(
      `
      UPDATE contacts
      SET account_id = (
        SELECT targets.account_id
        FROM targets
        WHERE targets.contact_id = contacts.id
          AND targets.account_id IS NOT NULL
        ORDER BY targets.created_at ASC
        LIMIT 1
      )
      WHERE contacts.account_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM targets
          WHERE targets.contact_id = contacts.id
            AND targets.account_id IS NOT NULL
        )
    `
    )
    .run().changes;

  return { accounts, linkedTargets: rows.length, linkedContacts };
}
