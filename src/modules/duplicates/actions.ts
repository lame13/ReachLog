"use server";

import { revalidatePath } from "next/cache";
import {
  accountDedupeKey
} from "@/modules/accounts/dedupe";
import {
  parseStoredLinks,
  parseTags,
  serializeLinks
} from "@/modules/contacts/queries";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import { recordEvent } from "@/modules/timeline/record";

export async function mergeAccountsAction(formData: FormData) {
  const keepId = clean(formData.get("keepId"));
  const mergeId = clean(formData.get("mergeId"));

  if (!keepId || !mergeId || keepId === mergeId) {
    return;
  }

  const sqlite = getSqlite();
  const keep = getAccount(keepId);
  const merge = getAccount(mergeId);

  if (!keep || !merge) {
    return;
  }

  const domain = keep.domain ?? merge.domain;
  const dedupeKey = accountDedupeKey({ name: keep.name, domain });
  const conflict = sqlite
    .prepare(
      "SELECT id FROM accounts WHERE dedupe_key = ? AND id NOT IN (?, ?)"
    )
    .get(dedupeKey, keepId, mergeId) as { id: string } | undefined;

  if (conflict) {
    return;
  }

  sqlite.transaction(() => {
    sqlite
      .prepare("UPDATE contacts SET account_id = ?, updated_at = ? WHERE account_id = ?")
      .run(keepId, new Date().toISOString(), mergeId);
    sqlite
      .prepare("UPDATE targets SET account_id = ?, updated_at = ? WHERE account_id = ?")
      .run(keepId, new Date().toISOString(), mergeId);
    sqlite
      .prepare("UPDATE events SET entity_id = ? WHERE entity_type = 'account' AND entity_id = ?")
      .run(keepId, mergeId);
    sqlite.prepare("DELETE FROM accounts WHERE id = ?").run(mergeId);
    sqlite
      .prepare(
        `
        UPDATE accounts
        SET domain = ?,
            website_url = COALESCE(NULLIF(website_url, ''), ?),
            dedupe_key = ?,
            notes = ?,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        domain || null,
        merge.websiteUrl,
        dedupeKey,
        mergeNotes(keep.notes, merge.notes),
        new Date().toISOString(),
        keepId
      );

    recordEvent({
      entityType: "account",
      entityId: keepId,
      eventType: "account_merged",
      payload: {
        mergedAccountId: mergeId,
        mergedAccountName: merge.name
      }
    });
  })();

  revalidateDuplicatePaths();
}

export async function mergeContactsAction(formData: FormData) {
  const keepId = clean(formData.get("keepId"));
  const mergeId = clean(formData.get("mergeId"));

  if (!keepId || !mergeId || keepId === mergeId) {
    return;
  }

  const sqlite = getSqlite();
  const keep = getContact(keepId);
  const merge = getContact(mergeId);

  if (!keep || !merge) {
    return;
  }

  const now = new Date().toISOString();

  sqlite.transaction(() => {
    sqlite
      .prepare("UPDATE targets SET contact_id = ?, updated_at = ? WHERE contact_id = ?")
      .run(keepId, now, mergeId);
    sqlite
      .prepare("UPDATE threads SET contact_id = ?, updated_at = ? WHERE contact_id = ?")
      .run(keepId, now, mergeId);
    sqlite
      .prepare(
        `
        DELETE FROM target_contacts
        WHERE contact_id = ?
          AND target_id IN (
            SELECT id FROM targets WHERE contact_id = ?
          )
      `
      )
      .run(keepId, keepId);

    const roles = sqlite
      .prepare(
        "SELECT target_id as targetId, role FROM target_contacts WHERE contact_id = ?"
      )
      .all(mergeId) as Array<{ targetId: string; role: string }>;

    for (const role of roles) {
      sqlite
        .prepare(
          `
          INSERT INTO target_contacts (
            id, target_id, contact_id, role, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(target_id, contact_id) DO NOTHING
        `
        )
        .run(
          createId("target_contact"),
          role.targetId,
          keepId,
          role.role,
          now,
          now
        );
    }

    sqlite
      .prepare("DELETE FROM target_contacts WHERE contact_id = ?")
      .run(mergeId);
    sqlite
      .prepare("UPDATE events SET entity_id = ? WHERE entity_type = 'contact' AND entity_id = ?")
      .run(keepId, mergeId);
    sqlite.prepare("DELETE FROM contacts WHERE id = ?").run(mergeId);

    sqlite
      .prepare(
        `
        UPDATE contacts
        SET account_id = COALESCE(account_id, ?),
            title = COALESCE(NULLIF(title, ''), ?),
            phone = COALESCE(NULLIF(phone, ''), ?),
            links_json = ?,
            tags = ?,
            notes = ?,
            email_verification_provider = COALESCE(email_verification_provider, ?),
            email_verification_status = COALESCE(email_verification_status, ?),
            email_verification_checked_at = COALESCE(email_verification_checked_at, ?),
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        merge.accountId,
        merge.title,
        merge.phone,
        serializeLinks(
          Array.from(
            new Set([
              ...parseStoredLinks(keep.linksJson),
              ...parseStoredLinks(merge.linksJson)
            ])
          )
        ),
        mergeTags(keep.tags, merge.tags),
        mergeNotes(keep.notes, merge.notes),
        merge.emailVerificationProvider,
        merge.emailVerificationStatus,
        merge.emailVerificationCheckedAt,
        now,
        keepId
      );

    recordEvent({
      entityType: "contact",
      entityId: keepId,
      eventType: "contact_merged",
      payload: {
        mergedContactId: mergeId,
        mergedContactEmail: merge.email
      }
    });
  })();

  revalidateDuplicatePaths();
}

function getAccount(id: string) {
  return getSqlite()
    .prepare(
      `
      SELECT
        id, name, domain, website_url as websiteUrl, notes, created_at as createdAt
      FROM accounts
      WHERE id = ?
    `
    )
    .get(id) as
    | {
        id: string;
        name: string;
        domain: string | null;
        websiteUrl: string | null;
        notes: string | null;
        createdAt: string;
      }
    | undefined;
}

function getContact(id: string) {
  return getSqlite()
    .prepare(
      `
      SELECT
        id,
        account_id as accountId,
        name,
        email,
        domain,
        title,
        phone,
        links_json as linksJson,
        tags,
        notes,
        email_verification_provider as emailVerificationProvider,
        email_verification_status as emailVerificationStatus,
        email_verification_checked_at as emailVerificationCheckedAt
      FROM contacts
      WHERE id = ?
    `
    )
    .get(id) as
    | {
        id: string;
        accountId: string | null;
        name: string;
        email: string;
        domain: string;
        title: string | null;
        phone: string | null;
        linksJson: string | null;
        tags: string | null;
        notes: string | null;
        emailVerificationProvider: string | null;
        emailVerificationStatus: string | null;
        emailVerificationCheckedAt: string | null;
      }
    | undefined;
}

function mergeNotes(left: string | null, right: string | null) {
  const values = [left?.trim(), right?.trim()].filter(
    (value, index, all): value is string =>
      Boolean(value) && all.indexOf(value) === index
  );

  return values.length ? values.join("\n\n") : null;
}

function mergeTags(left: string | null, right: string | null) {
  const values = Array.from(
    new Set([...parseTags(left), ...parseTags(right)])
  );

  return values.length ? values.join(",") : null;
}

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function revalidateDuplicatePaths() {
  revalidatePath("/duplicates");
  revalidatePath("/accounts");
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/analytics");
}
