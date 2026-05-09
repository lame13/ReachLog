"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import {
  contactFormDedupeKey,
  domainDedupeKey,
  emailDedupeKey,
  normalizeDomain,
  sourceDedupeKey
} from "@/modules/outreach/dedupe";

type TargetFormValues = {
  targetId?: string;
  contactId?: string | null;
  companyName: string;
  contactName: string;
  email: string;
  websiteUrl: string;
  sourceType: string;
  sourceUrl: string;
  dedupeKey: string;
  status: string;
};

export async function createTargetAction(formData: FormData) {
  const values = getTargetFormValues(formData);

  if (!values.companyName) {
    return;
  }

  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const dedupeKey = values.dedupeKey || inferDedupeKey(values);

  if (!dedupeKey) {
    return;
  }

  const existingTarget = sqlite
    .prepare("SELECT id FROM targets WHERE dedupe_key = ?")
    .get(dedupeKey) as { id: string } | undefined;

  if (existingTarget) {
    redirect(`/targets/${existingTarget.id}`);
  }

  const targetId = createId("target");

  const transaction = sqlite.transaction(() => {
    const contactId = upsertContact({
      contactId: null,
      name: values.contactName || values.companyName,
      email: values.email,
      domain: inferDomain(values),
      now
    });

    sqlite
      .prepare(
        `
        INSERT INTO targets (
          id, contact_id, company_name, website_url, source_type, source_url,
          dedupe_key, status, do_not_resend, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `
      )
      .run(
        targetId,
        contactId,
        values.companyName,
        values.websiteUrl || null,
        values.sourceType,
        values.sourceUrl || null,
        dedupeKey,
        values.status || "new",
        now,
        now
      );

    insertTargetEvent(targetId, "target_created", {
      dedupeKey,
      sourceType: values.sourceType,
      sourceUrl: values.sourceUrl || null
    });
  });

  transaction();
  revalidatePath("/dashboard");
  revalidatePath("/targets");
  revalidatePath("/analytics");
  redirect(`/targets/${targetId}`);
}

export async function updateTargetAction(formData: FormData) {
  const values = getTargetFormValues(formData);
  const targetId = values.targetId;

  if (!targetId || !values.companyName) {
    return;
  }

  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const dedupeKey = values.dedupeKey || inferDedupeKey(values);

  if (!dedupeKey) {
    return;
  }

  const duplicateTarget = sqlite
    .prepare("SELECT id FROM targets WHERE dedupe_key = ? AND id <> ?")
    .get(dedupeKey, targetId) as { id: string } | undefined;

  if (duplicateTarget) {
    insertTargetEvent(targetId, "target_update_blocked", {
      reason: "duplicate_dedupe_key",
      dedupeKey,
      duplicateTargetId: duplicateTarget.id
    });
    revalidateTarget(targetId);
    return;
  }

  const transaction = sqlite.transaction(() => {
    const contactId = upsertContact({
      contactId: values.contactId,
      name: values.contactName || values.companyName,
      email: values.email,
      domain: inferDomain(values),
      now
    });

    sqlite
      .prepare(
        `
        UPDATE targets
        SET contact_id = ?,
            company_name = ?,
            website_url = ?,
            source_type = ?,
            source_url = ?,
            dedupe_key = ?,
            status = ?,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        contactId,
        values.companyName,
        values.websiteUrl || null,
        values.sourceType,
        values.sourceUrl || null,
        dedupeKey,
        values.status || "new",
        now,
        targetId
      );

    insertTargetEvent(targetId, "target_updated", {
      dedupeKey,
      sourceType: values.sourceType,
      status: values.status
    });
  });

  transaction();
  revalidateTarget(targetId);
}

export async function updateDoNotResendAction(formData: FormData) {
  const targetId = String(formData.get("targetId") ?? "");
  const enabled = formData.get("enabled") === "true";

  if (!targetId) {
    return;
  }

  const sqlite = getSqlite();
  const now = new Date().toISOString();

  const transaction = sqlite.transaction(() => {
    let cancelledFollowups = 0;

    if (enabled) {
      sqlite
        .prepare(
          "UPDATE targets SET do_not_resend = 1, status = 'dead', updated_at = ? WHERE id = ?"
        )
        .run(now, targetId);

      cancelledFollowups = sqlite
        .prepare(
          `
          UPDATE followup_tasks
          SET status = 'cancelled',
              completed_at = ?
          WHERE target_id = ?
            AND status = 'open'
        `
        )
        .run(now, targetId).changes;
    } else {
      sqlite
        .prepare("UPDATE targets SET do_not_resend = 0, updated_at = ? WHERE id = ?")
        .run(now, targetId);
    }

    insertTargetEvent(
      targetId,
      enabled ? "do_not_resend_enabled" : "do_not_resend_disabled",
      { enabled, cancelledFollowups }
    );
  });

  transaction();
  revalidateTarget(targetId);
}

export async function addTargetNoteAction(formData: FormData) {
  const targetId = String(formData.get("targetId") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!targetId || !note) {
    return;
  }

  insertTargetEvent(targetId, "note_added", { note });

  revalidateTarget(targetId);
}

function getTargetFormValues(formData: FormData): TargetFormValues {
  return {
    targetId: clean(formData.get("targetId")),
    contactId: clean(formData.get("contactId")),
    companyName: clean(formData.get("companyName")),
    contactName: clean(formData.get("contactName")),
    email: clean(formData.get("email")).toLowerCase(),
    websiteUrl: clean(formData.get("websiteUrl")),
    sourceType: clean(formData.get("sourceType")) || "manual",
    sourceUrl: clean(formData.get("sourceUrl")),
    dedupeKey: clean(formData.get("dedupeKey")),
    status: clean(formData.get("status")) || "new"
  };
}

function upsertContact({
  contactId,
  name,
  email,
  domain,
  now
}: {
  contactId: string | null | undefined;
  name: string;
  email: string;
  domain: string;
  now: string;
}) {
  const sqlite = getSqlite();

  if (!email) {
    return null;
  }

  const existing = sqlite
    .prepare("SELECT id FROM contacts WHERE email = ?")
    .get(email) as { id: string } | undefined;

  if (existing) {
    sqlite
      .prepare(
        "UPDATE contacts SET name = ?, domain = ?, updated_at = ? WHERE id = ?"
      )
      .run(name, domain || email.split("@")[1] || "unknown", now, existing.id);
    return existing.id;
  }

  if (contactId) {
    sqlite
      .prepare(
        "UPDATE contacts SET name = ?, email = ?, domain = ?, updated_at = ? WHERE id = ?"
      )
      .run(name, email, domain || email.split("@")[1] || "unknown", now, contactId);
    return contactId;
  }

  const newContactId = createId("contact");

  sqlite
    .prepare(
      `
      INSERT INTO contacts (id, name, email, domain, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    )
    .run(newContactId, name, email, domain || email.split("@")[1] || "unknown", now, now);

  return newContactId;
}

function inferDedupeKey(values: TargetFormValues) {
  if (values.email) {
    return emailDedupeKey(values.email);
  }

  if (values.sourceType === "contact_form" && values.sourceUrl) {
    try {
      return contactFormDedupeKey(values.sourceUrl);
    } catch {
      return sourceDedupeKey("form", values.sourceUrl);
    }
  }

  if (values.sourceUrl) {
    return sourceDedupeKey(values.sourceType, values.sourceUrl);
  }

  const domain = inferDomain(values);

  return domain ? domainDedupeKey(domain) : "";
}

function inferDomain(values: Pick<TargetFormValues, "email" | "websiteUrl" | "sourceUrl">) {
  if (values.email.includes("@")) {
    return values.email.split("@").pop() ?? "";
  }

  const url = values.websiteUrl || values.sourceUrl;

  if (!url) {
    return "";
  }

  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return normalizeDomain(url);
  }
}

function insertTargetEvent(
  targetId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  getSqlite()
    .prepare(
      `
      INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at)
      VALUES (?, 'target', ?, ?, ?, ?)
    `
    )
    .run(
      createId("event"),
      targetId,
      eventType,
      JSON.stringify(payload),
      new Date().toISOString()
    );
}

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function revalidateTarget(targetId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/targets");
  revalidatePath(`/targets/${targetId}`);
  revalidatePath("/analytics");
}
