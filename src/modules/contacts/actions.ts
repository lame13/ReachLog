"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normalizeAccountDomain } from "@/modules/accounts/dedupe";
import {
  parseLinksText,
  serializeLinks
} from "@/modules/contacts/queries";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import { markContactEmailVerificationPending, verifyContactEmailOnce } from "@/modules/emailVerification/service";
import { recordEvent } from "@/modules/timeline/record";

type ContactFormValues = {
  contactId: string;
  accountId: string | null;
  name: string;
  email: string;
  domain: string;
  title: string;
  phone: string;
  links: string[];
  tags: string;
  notes: string;
};

export async function createContactAction(formData: FormData) {
  const values = getContactFormValues(formData);

  if (!values.email) {
    return;
  }

  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const existing = sqlite
    .prepare("SELECT id FROM contacts WHERE email = ?")
    .get(values.email) as { id: string } | undefined;

  if (existing) {
    redirect(`/contacts/${existing.id}`);
  }

  const contactId = createId("contact");
  const domain = values.domain || values.email.split("@")[1] || "unknown";

  sqlite
    .prepare(
      `
      INSERT INTO contacts (
        id, account_id, name, email, domain, title, phone, links_json, tags, notes,
        email_verification_provider, email_verification_status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'emaillistverify', 'pending', ?, ?)
    `
    )
    .run(
      contactId,
      values.accountId,
      values.name || values.email.split("@")[0],
      values.email,
      domain,
      values.title || null,
      values.phone || null,
      serializeLinks(values.links),
      values.tags || null,
      values.notes || null,
      now,
      now
    );

  recordEvent({
    entityType: "contact",
    entityId: contactId,
    eventType: "contact_created",
    payload: { email: values.email, accountId: values.accountId ?? null }
  });

  await verifyContactEmailOnce({ contactId });
  revalidateContacts(contactId);
  redirect(`/contacts/${contactId}`);
}

export async function updateContactAction(formData: FormData) {
  const values = getContactFormValues(formData);

  if (!values.contactId || !values.email) {
    return;
  }

  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const current = sqlite
    .prepare("SELECT email FROM contacts WHERE id = ?")
    .get(values.contactId) as { email: string } | undefined;

  if (!current) {
    return;
  }

  const takenBy = sqlite
    .prepare("SELECT id FROM contacts WHERE email = ? AND id <> ?")
    .get(values.email, values.contactId) as { id: string } | undefined;

  if (takenBy) {
    recordEvent({
      entityType: "contact",
      entityId: values.contactId,
      eventType: "contact_update_blocked",
      payload: { reason: "duplicate_email", email: values.email, duplicateContactId: takenBy.id }
    });
    revalidateContacts(values.contactId);
    return;
  }

  const emailChanged = current.email.toLowerCase() !== values.email;
  const domain = values.domain || values.email.split("@")[1] || "unknown";

  sqlite
    .prepare(
      `
      UPDATE contacts
      SET account_id = ?, name = ?, email = ?, domain = ?, title = ?, phone = ?,
          links_json = ?, tags = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      values.accountId,
      values.name || values.email.split("@")[0],
      values.email,
      domain,
      values.title || null,
      values.phone || null,
      serializeLinks(values.links),
      values.tags || null,
      values.notes || null,
      now,
      values.contactId
    );

  if (emailChanged) {
    markContactEmailVerificationPending(values.contactId, now);
  }

  recordEvent({
    entityType: "contact",
    entityId: values.contactId,
    eventType: "contact_updated",
    payload: { email: values.email, accountId: values.accountId ?? null, emailChanged }
  });

  revalidateContacts(values.contactId);

  if (emailChanged) {
    await verifyContactEmailOnce({ contactId: values.contactId });
  }
}

export async function addContactNoteAction(formData: FormData) {
  const contactId = clean(formData.get("contactId"));
  const note = clean(formData.get("note"));

  if (!contactId || !note) {
    return;
  }

  recordEvent({
    entityType: "contact",
    entityId: contactId,
    eventType: "contact_note_added",
    payload: { note }
  });

  revalidateContacts(contactId);
}

function getContactFormValues(formData: FormData): ContactFormValues {
  const email = clean(formData.get("email")).toLowerCase();
  const accountId = clean(formData.get("accountId"));

  return {
    contactId: clean(formData.get("contactId")),
    accountId: accountId || null,
    name: clean(formData.get("name")),
    email,
    domain: normalizeAccountDomain(clean(formData.get("domain"))),
    title: clean(formData.get("title")),
    phone: clean(formData.get("phone")),
    links: parseLinksText(clean(formData.get("links"))),
    tags: clean(formData.get("tags")),
    notes: clean(formData.get("notes"))
  };
}

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function revalidateContacts(contactId?: string) {
  revalidatePath("/contacts");
  revalidatePath("/accounts");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/targets");

  if (contactId) {
    revalidatePath(`/contacts/${contactId}`);
  }
}
