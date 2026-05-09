import { env } from "../core/env";
import { getSqlite } from "../core/db/client";
import { createId } from "../core/ids";

const PROVIDER = "emaillistverify";
const VERIFY_URL = "https://apps.emaillistverify.com/api/verifyEmail";

const BLOCKING_STATUSES = new Set([
  "fail",
  "invalid",
  "invalid_mx",
  "email_disabled",
  "dead_server",
  "disposable",
  "incorrect"
]);

type ContactVerificationRow = {
  id: string;
  email: string;
  emailVerificationCheckedAt: string | null;
};

export function markContactEmailVerificationPending(contactId: string, now: string) {
  getSqlite()
    .prepare(
      `
      UPDATE contacts
      SET email_verification_provider = ?,
          email_verification_status = 'pending',
          email_verification_checked_at = NULL,
          email_verification_error = NULL,
          email_verification_raw = NULL,
          updated_at = ?
      WHERE id = ?
    `
    )
    .run(PROVIDER, now, contactId);
}

export function isEmailVerificationBlocking(status: string | null | undefined) {
  return BLOCKING_STATUSES.has(normalizeStatus(status));
}

export async function verifyContactEmailOnce({
  contactId,
  targetId
}: {
  contactId: string | null | undefined;
  targetId?: string | null;
}) {
  if (!contactId) {
    return { checked: false, reason: "missing_contact" };
  }

  const contact = getContactVerificationRow(contactId);

  if (!contact?.email) {
    return { checked: false, reason: "missing_email" };
  }

  if (contact.emailVerificationCheckedAt) {
    return { checked: false, reason: "already_checked" };
  }

  return verifyAndStoreContactEmail({ contactId, email: contact.email, targetId });
}

export async function forceRecheckContactEmail({
  contactId,
  targetId
}: {
  contactId: string | null | undefined;
  targetId?: string | null;
}) {
  if (!contactId) {
    return { checked: false, reason: "missing_contact" };
  }

  const contact = getContactVerificationRow(contactId);

  if (!contact?.email) {
    return { checked: false, reason: "missing_email" };
  }

  return verifyAndStoreContactEmail({ contactId, email: contact.email, targetId });
}

export async function verifyPendingContacts(limit = env.EMAILLISTVERIFY_BATCH_SIZE) {
  if (!isEmailListVerifyConfigured()) {
    return { checked: 0, skipped: true, reason: "emaillistverify_not_configured" };
  }

  const rows = getSqlite()
    .prepare(
      `
      SELECT
        contacts.id,
        contacts.email,
        targets.id as targetId
      FROM contacts
      LEFT JOIN targets ON targets.contact_id = contacts.id
      WHERE contacts.email_verification_checked_at IS NULL
        AND (
          contacts.email_verification_status IS NULL
          OR contacts.email_verification_status IN ('pending', 'not_configured')
        )
      GROUP BY contacts.id
      ORDER BY contacts.created_at ASC
      LIMIT ?
    `
    )
    .all(limit) as Array<{ id: string; email: string; targetId: string | null }>;

  let checked = 0;

  for (const row of rows) {
    const result = await verifyAndStoreContactEmail({
      contactId: row.id,
      email: row.email,
      targetId: row.targetId
    });

    if (result.checked) {
      checked += 1;
    }
  }

  return { checked, skipped: false };
}

async function verifyAndStoreContactEmail({
  contactId,
  email,
  targetId
}: {
  contactId: string;
  email: string;
  targetId?: string | null;
}) {
  const now = new Date().toISOString();

  if (!env.EMAILLISTVERIFY_ENABLED) {
    return { checked: false, reason: "emaillistverify_disabled" };
  }

  if (!env.EMAILLISTVERIFY_API_KEY) {
    storeVerificationResult({
      contactId,
      status: "not_configured",
      checkedAt: null,
      error: "EMAILLISTVERIFY_ENABLED=true and EMAILLISTVERIFY_API_KEY are required.",
      raw: null,
      now
    });
    return { checked: false, reason: "emaillistverify_not_configured" };
  }

  const result = await verifyEmail(email);

  storeVerificationResult({
    contactId,
    status: result.status,
    checkedAt: now,
    error: result.error,
    raw: result.raw,
    now
  });

  if (targetId) {
    insertTargetEvent(targetId, result.error ? "email_verification_failed" : "email_verified", {
      provider: PROVIDER,
      email,
      status: result.status,
      error: result.error
    });
  }

  return { checked: true, status: result.status, error: result.error };
}

async function verifyEmail(email: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.EMAILLISTVERIFY_TIMEOUT_MS);
  const url = new URL(VERIFY_URL);
  url.searchParams.set("secret", env.EMAILLISTVERIFY_API_KEY ?? "");
  url.searchParams.set("email", email);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const raw = (await response.text()).trim();
    const status = normalizeStatus(raw || `http_${response.status}`);

    if (!response.ok) {
      return {
        status,
        raw,
        error: `emaillistverify_http_${response.status}`
      };
    }

    if (status === "key_not_valid" || status === "missing parameters") {
      return {
        status,
        raw,
        error: status
      };
    }

    return { status, raw, error: null };
  } catch (error) {
    return {
      status: "request_failed",
      raw: null,
      error: error instanceof Error ? error.message : "emaillistverify_request_failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function storeVerificationResult({
  contactId,
  status,
  checkedAt,
  error,
  raw,
  now
}: {
  contactId: string;
  status: string;
  checkedAt: string | null;
  error: string | null;
  raw: string | null;
  now: string;
}) {
  getSqlite()
    .prepare(
      `
      UPDATE contacts
      SET email_verification_provider = ?,
          email_verification_status = ?,
          email_verification_checked_at = ?,
          email_verification_error = ?,
          email_verification_raw = ?,
          updated_at = ?
      WHERE id = ?
    `
    )
    .run(PROVIDER, status, checkedAt, error, raw, now, contactId);
}

function getContactVerificationRow(contactId: string) {
  return getSqlite()
    .prepare(
      `
      SELECT
        id,
        email,
        email_verification_checked_at as emailVerificationCheckedAt
      FROM contacts
      WHERE id = ?
    `
    )
    .get(contactId) as ContactVerificationRow | undefined;
}

function isEmailListVerifyConfigured() {
  return env.EMAILLISTVERIFY_ENABLED && Boolean(env.EMAILLISTVERIFY_API_KEY);
}

function normalizeStatus(status: string | null | undefined) {
  return (status ?? "").trim().toLowerCase();
}

function insertTargetEvent(
  targetId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  getSqlite()
    .prepare(
      "INSERT INTO events (id, entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, 'target', ?, ?, ?, ?)"
    )
    .run(
      createId("event"),
      targetId,
      eventType,
      JSON.stringify(payload),
      new Date().toISOString()
    );
}
