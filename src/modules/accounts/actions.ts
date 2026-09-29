"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  accountDedupeKey,
  normalizeAccountDomain
} from "@/modules/accounts/dedupe";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import { recordEvent } from "@/modules/timeline/record";

/**
 * Accounts are created automatically whenever a target names a company, so the
 * manual form is for the cases outreach alone cannot express: a company with no
 * target yet, or notes that belong to the company rather than one contact.
 */
export async function createAccountAction(formData: FormData) {
  const name = clean(formData.get("name"));
  const domain = normalizeAccountDomain(clean(formData.get("domain")));
  const websiteUrl = clean(formData.get("websiteUrl"));
  const notes = clean(formData.get("notes"));

  if (!name) {
    return;
  }

  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const dedupeKey = accountDedupeKey({ name, domain });

  if (!dedupeKey) {
    return;
  }

  const existing = sqlite
    .prepare("SELECT id FROM accounts WHERE dedupe_key = ?")
    .get(dedupeKey) as { id: string } | undefined;

  if (existing) {
    redirect(`/accounts/${existing.id}`);
  }

  const accountId = createId("account");

  sqlite
    .prepare(
      `
      INSERT INTO accounts (id, name, domain, website_url, dedupe_key, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      accountId,
      name,
      domain || null,
      websiteUrl || null,
      dedupeKey,
      notes || null,
      now,
      now
    );

  recordEvent({
    entityType: "account",
    entityId: accountId,
    eventType: "account_created",
    payload: { dedupeKey, domain: domain || null }
  });

  revalidateAccounts();
  redirect(`/accounts/${accountId}`);
}

export async function updateAccountAction(formData: FormData) {
  const accountId = clean(formData.get("accountId"));
  const name = clean(formData.get("name"));
  const domain = normalizeAccountDomain(clean(formData.get("domain")));
  const websiteUrl = clean(formData.get("websiteUrl"));
  const notes = clean(formData.get("notes"));

  if (!accountId || !name) {
    return;
  }

  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const dedupeKey = accountDedupeKey({ name, domain });

  if (!dedupeKey) {
    return;
  }

  const duplicate = sqlite
    .prepare("SELECT id FROM accounts WHERE dedupe_key = ? AND id <> ?")
    .get(dedupeKey, accountId) as { id: string } | undefined;

  if (duplicate) {
    recordEvent({
      entityType: "account",
      entityId: accountId,
      eventType: "account_update_blocked",
      payload: {
        reason: "duplicate_account",
        dedupeKey,
        duplicateAccountId: duplicate.id
      }
    });
    revalidateAccounts(accountId);
    return;
  }

  sqlite
    .prepare(
      `
      UPDATE accounts
      SET name = ?, domain = ?, website_url = ?, dedupe_key = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      name,
      domain || null,
      websiteUrl || null,
      dedupeKey,
      notes || null,
      now,
      accountId
    );

  recordEvent({
    entityType: "account",
    entityId: accountId,
    eventType: "account_updated",
    payload: { dedupeKey, domain: domain || null }
  });

  revalidateAccounts(accountId);
}

export async function addAccountNoteAction(formData: FormData) {
  const accountId = clean(formData.get("accountId"));
  const note = clean(formData.get("note"));

  if (!accountId || !note) {
    return;
  }

  recordEvent({
    entityType: "account",
    entityId: accountId,
    eventType: "account_note_added",
    payload: { note }
  });

  revalidateAccounts(accountId);
}

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function revalidateAccounts(accountId?: string) {
  revalidatePath("/accounts");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");

  if (accountId) {
    revalidatePath(`/accounts/${accountId}`);
  }
}
