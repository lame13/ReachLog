"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { findOrCreateAccount } from "@/modules/accounts/store";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import {
  contactFormDedupeKey,
  domainDedupeKey,
  emailDedupeKey,
  normalizeDomain,
  sourceDedupeKey
} from "@/modules/outreach/dedupe";
import {
  markContactEmailVerificationPending,
  verifyContactEmailOnce
} from "@/modules/emailVerification/service";
import {
  isDoNotResendHardBlock,
  isSendBlockedStatus
} from "@/modules/outreach/status";
import {
  stageFromLegacyStatus,
  isPipelineStage,
  statusForStageMove
} from "@/modules/pipeline/stages";
import { recordEvent } from "@/modules/timeline/record";

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
  stage: string;
  doNotResend: boolean;
  replyType: string;
  nextFollowupDate: string;
  nextFollowupTime: string;
  note: string;
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

  let contactIdToVerify: string | null = null;

  const transaction = sqlite.transaction(() => {
    const accountId = findOrCreateAccount({
      sqlite,
      name: values.companyName,
      domain: inferDomain(values),
      websiteUrl: values.websiteUrl,
      now
    });
    const contactId = upsertContact({
      contactId: null,
      name: values.contactName || values.companyName,
      email: values.email,
      domain: inferDomain(values),
      accountId,
      now
    });
    contactIdToVerify = contactId;

    sqlite
      .prepare(
        `
        INSERT INTO targets (
          id, contact_id, account_id, company_name, website_url, source_type,
          source_url, dedupe_key, status, stage, do_not_resend, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        targetId,
        contactId,
        accountId,
        values.companyName,
        values.websiteUrl || null,
        values.sourceType,
        values.sourceUrl || null,
        dedupeKey,
        values.status || "new",
        isPipelineStage(values.stage) ? values.stage : stageFromLegacyStatus(values.status),
        values.doNotResend ? 1 : 0,
        now,
        now
      );

    recordEvent({
      entityType: "target",
      entityId: targetId,
      eventType: "target_created",
      payload: {
        dedupeKey,
        sourceType: values.sourceType,
        sourceUrl: values.sourceUrl || null,
        accountId,
        stage: isPipelineStage(values.stage) ? values.stage : stageFromLegacyStatus(values.status)
      }
    });
  });

  transaction();
  await verifyContactEmailOnce({ contactId: contactIdToVerify, targetId });
  revalidatePath("/dashboard");
  revalidatePath("/targets");
  revalidatePath("/pipeline");
  revalidatePath("/accounts");
  revalidatePath("/contacts");
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
    recordEvent({
      entityType: "target",
      entityId: targetId,
      eventType: "target_update_blocked",
      payload: {
        reason: "duplicate_dedupe_key",
        dedupeKey,
        duplicateTargetId: duplicateTarget.id
      }
    });
    revalidateTarget(targetId);
    return;
  }

  let contactIdToVerify: string | null = null;
  const nextFollowupAt = getNextFollowupIso(values);
  const nextStage = isPipelineStage(values.stage) ? values.stage : null;
  const currentTarget = sqlite
    .prepare("SELECT stage, status FROM targets WHERE id = ?")
    .get(targetId) as { stage: string; status: string } | undefined;

  if (!currentTarget) {
    return;
  }

  // Changing the stage carries the outreach status with it, unless the status
  // field was edited by hand in the same save.
  const nextStatus =
    nextStage && nextStage !== currentTarget.stage && values.status === currentTarget.status
      ? statusForStageMove(currentTarget.status, nextStage, values.doNotResend)
      : values.status || "new";

  const transaction = sqlite.transaction(() => {
    const accountId = findOrCreateAccount({
      sqlite,
      name: values.companyName,
      domain: inferDomain(values),
      websiteUrl: values.websiteUrl,
      now
    });
    const contactId = upsertContact({
      contactId: values.contactId,
      name: values.contactName || values.companyName,
      email: values.email,
      domain: inferDomain(values),
      accountId,
      now
    });
    contactIdToVerify = contactId;

    sqlite
      .prepare(
        `
        UPDATE targets
        SET contact_id = ?,
            account_id = COALESCE(?, account_id),
            company_name = ?,
            website_url = ?,
            source_type = ?,
            source_url = ?,
            dedupe_key = ?,
            status = ?,
            stage = COALESCE(?, stage),
            do_not_resend = ?,
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        contactId,
        accountId,
        values.companyName,
        values.websiteUrl || null,
        values.sourceType,
        values.sourceUrl || null,
        dedupeKey,
        nextStatus,
        nextStage,
        values.doNotResend ? 1 : 0,
        now,
        targetId
      );

    const targetHardBlocked =
      nextStage === "lost" ||
      isSendBlockedStatus(nextStatus) ||
      isDoNotResendHardBlock({
        doNotResend: values.doNotResend,
        status: nextStatus
      });
    const currentOpenFollowup = sqlite
      .prepare(
        `
        SELECT id, due_at as dueAt
        FROM followup_tasks
        WHERE target_id = ?
          AND status = 'open'
        ORDER BY due_at ASC
        LIMIT 1
      `
      )
      .get(targetId) as { id: string; dueAt: string } | undefined;
    let followupId: string | null = null;

    if (targetHardBlocked) {
      sqlite
        .prepare(
          `
          UPDATE followup_tasks
          SET status = 'cancelled',
              completed_at = ?
          WHERE target_id = ?
            AND status = 'open'
        `
        )
        .run(now, targetId);
    } else if (nextFollowupAt && currentOpenFollowup?.dueAt !== nextFollowupAt) {
      const latestThread = sqlite
        .prepare(
          `
          SELECT id, subject
          FROM threads
          WHERE target_id = ?
          ORDER BY COALESCE(last_inbound_at, last_outbound_at, updated_at) DESC
          LIMIT 1
        `
        )
        .get(targetId) as { id: string; subject: string } | undefined;

      sqlite
        .prepare(
          `
          UPDATE followup_tasks
          SET status = 'cancelled',
              completed_at = ?
          WHERE target_id = ?
            AND status = 'open'
        `
        )
        .run(now, targetId);

      followupId = createId("followup");

      sqlite
        .prepare(
          `
          INSERT INTO followup_tasks (
            id, thread_id, target_id, due_at, status, suggested_subject,
            suggested_body, notification_sent_at, notification_channel,
            notification_status, completed_at, created_at
          )
          VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, NULL, NULL, NULL, ?)
        `
        )
        .run(
          followupId,
          latestThread?.id ?? null,
          targetId,
          nextFollowupAt,
          latestThread?.subject
            ? `Re: ${latestThread.subject.replace(/^(?:(?:re|fw|fwd):\s*)+/i, "")}`
            : null,
          values.note || null,
          now
        );
    }

    recordEvent({
      entityType: "target",
      entityId: targetId,
      eventType: "target_updated",
      payload: {
        dedupeKey,
        sourceType: values.sourceType,
        status: nextStatus,
        stage: nextStage ?? currentTarget.stage,
        doNotResend: values.doNotResend,
        replyType: values.replyType || null,
        nextFollowupAt,
        followupId,
        note: values.note || null
      }
    });
  });

  transaction();
  await verifyContactEmailOnce({ contactId: contactIdToVerify, targetId });
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
          "UPDATE targets SET do_not_resend = 1, status = 'dead', stage = 'lost', updated_at = ? WHERE id = ?"
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

    recordEvent({
      entityType: "target",
      entityId: targetId,
      eventType: enabled ? "do_not_resend_enabled" : "do_not_resend_disabled",
      payload: { enabled, cancelledFollowups }
    });
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

  recordEvent({
    entityType: "target",
    entityId: targetId,
    eventType: "note_added",
    payload: { note }
  });

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
    status: clean(formData.get("status")) || "new",
    stage: clean(formData.get("stage")),
    doNotResend: formData.get("doNotResend") === "on",
    replyType: clean(formData.get("replyType")),
    nextFollowupDate: clean(formData.get("nextFollowupDate")),
    nextFollowupTime: clean(formData.get("nextFollowupTime")) || "09:00",
    note: clean(formData.get("note"))
  };
}

function getNextFollowupIso(values: TargetFormValues) {
  if (!values.nextFollowupDate) {
    return null;
  }

  const date = new Date(`${values.nextFollowupDate}T${values.nextFollowupTime || "09:00"}:00`);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function upsertContact({
  contactId,
  name,
  email,
  domain,
  accountId,
  now
}: {
  contactId: string | null | undefined;
  name: string;
  email: string;
  domain: string;
  accountId: string | null;
  now: string;
}) {
  const sqlite = getSqlite();

  if (!email) {
    return null;
  }

  const existing = sqlite
    .prepare("SELECT id FROM contacts WHERE email = ?")
    .get(email) as { id: string; emailVerificationStatus: string | null } | undefined;

  if (existing) {
    sqlite
      .prepare(
        `
        UPDATE contacts
        SET name = ?,
            domain = ?,
            account_id = COALESCE(account_id, ?),
            email_verification_provider = COALESCE(email_verification_provider, 'emaillistverify'),
            email_verification_status = COALESCE(email_verification_status, 'pending'),
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(name, domain || email.split("@")[1] || "unknown", accountId, now, existing.id);
    return existing.id;
  }

  if (contactId) {
    const current = sqlite
      .prepare("SELECT email FROM contacts WHERE id = ?")
      .get(contactId) as { email: string } | undefined;
    const emailChanged = Boolean(current && current.email.toLowerCase() !== email);

    sqlite
      .prepare(
        `
        UPDATE contacts
        SET name = ?,
            email = ?,
            domain = ?,
            account_id = COALESCE(account_id, ?),
            updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        name,
        email,
        domain || email.split("@")[1] || "unknown",
        accountId,
        now,
        contactId
      );

    if (emailChanged) {
      markContactEmailVerificationPending(contactId, now);
    }

    return contactId;
  }

  const newContactId = createId("contact");

  sqlite
    .prepare(
      `
      INSERT INTO contacts (
        id, account_id, name, email, domain, email_verification_provider,
        email_verification_status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'emaillistverify', 'pending', ?, ?)
    `
    )
    .run(
      newContactId,
      accountId,
      name,
      email,
      domain || email.split("@")[1] || "unknown",
      now,
      now
    );

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

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function revalidateTarget(targetId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/targets");
  revalidatePath("/pipeline");
  revalidatePath("/accounts");
  revalidatePath("/contacts");
  revalidatePath(`/targets/${targetId}`);
  revalidatePath("/analytics");
}
