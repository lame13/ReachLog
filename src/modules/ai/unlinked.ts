import { findOrCreateAccount } from "@/modules/accounts/store";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import { emailDedupeKey, normalizeDomain } from "@/modules/outreach/dedupe";
import { recordEvent } from "@/modules/timeline/record";
import { aiReady, getAiRun, runAiJson } from "./client";
import { AI_SYSTEM_PROMPT, unlinkedLeadPrompt } from "./prompts";
import { unlinkedLeadSchema, type UnlinkedLeadOutput } from "./schemas";
import { setReviewStatus } from "./triage";

const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
  "hey.com",
  "fastmail.com",
  "mail.com"
]);

const AUTOMATED_LOCAL_PARTS = new Set([
  "no-reply",
  "noreply",
  "do-not-reply",
  "mailer-daemon",
  "postmaster",
  "notifications",
  "notification",
  "newsletter",
  "bounce",
  "bounces"
]);

export type UnlinkedResult = {
  eventId: string;
  kind: string;
  confidence: number;
  captured: boolean;
  targetId?: string;
};

export async function processUnlinkedMail(
  request: typeof fetch = fetch,
  limit = 10
): Promise<UnlinkedResult[]> {
  if (!aiReady()) return [];
  const sqlite = getSqlite();
  const events = sqlite
    .prepare(
      `
      SELECT
        events.id,
        events.payload_json as payloadJson
      FROM events
      WHERE events.event_type = 'mail_seen_unlinked'
        AND json_valid(events.payload_json)
        AND NULLIF(json_extract(events.payload_json, '$.bodyText'), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM ai_runs
          WHERE ai_runs.kind = 'unlinked_lead'
            AND ai_runs.entity_id = events.id
            AND ai_runs.status IN ('success', 'running')
        )
      ORDER BY events.created_at DESC
      LIMIT ?
    `
    )
    .all(limit) as Array<{ id: string; payloadJson: string | null }>;

  const results: UnlinkedResult[] = [];

  for (const event of events) {
    try {
      const result = await processOneUnlinked(event.id, event.payloadJson, request);
      if (result) results.push(result);
    } catch {
      results.push({
        eventId: event.id,
        kind: "error",
        confidence: 0,
        captured: false
      });
    }
  }

  return results;
}

async function processOneUnlinked(
  eventId: string,
  payloadJson: string | null,
  request: typeof fetch
): Promise<UnlinkedResult | null> {
  const payload = parsePayload(payloadJson);
  const from = normalizeEmail(payload.from);
  const subject = payload.subject?.trim() || "(no subject)";
  const bodyText = payload.bodyText?.trim() || "";

  if (!from || !bodyText.trim()) return null;
  if (isAutomatedAddress(from)) return null;
  if (existingContact(from)) return null;

  const now = new Date().toISOString();
  const { run, output } = await runAiJson({
    kind: "unlinked_lead",
    entityType: "event",
    entityId: eventId,
    input: { from, subject, bodyText },
    schema: unlinkedLeadSchema,
    system: AI_SYSTEM_PROMPT,
    user: unlinkedLeadPrompt({
      now,
      from,
      to: payload.to ?? "",
      subject,
      body: bodyText
    }),
    request
  });

  const actionable =
    ["lead", "referral"].includes(output.kind) &&
    output.isHuman &&
    output.confidence >= 0.85;

  if (!actionable) {
    const reviewWorthy =
      (["lead", "referral"].includes(output.kind) && output.isHuman) ||
      output.kind === "unclear";
    setReviewStatus(
      run.id,
      reviewWorthy ? "pending" : "none"
    );
    return {
      eventId,
      kind: output.kind,
      confidence: output.confidence,
      captured: false
    };
  }

  const email = normalizeEmail(output.email) || from;

  if (isAutomatedAddress(email) || existingTarget(email)) {
    setReviewStatus(run.id, "none");
    return {
      eventId,
      kind: output.kind,
      confidence: output.confidence,
      captured: false
    };
  }

  const targetId = captureLead({
    runId: run.id,
    eventId,
    email,
    output,
    now
  });
  setReviewStatus(run.id, "applied");

  return {
    eventId,
    kind: output.kind,
    confidence: output.confidence,
    captured: true,
    targetId
  };
}

export function captureUnlinkedRun(runId: string) {
  const run = getAiRun(runId);
  if (!run || run.kind !== "unlinked_lead" || !run.outputJson) return null;
  const output = unlinkedLeadSchema.parse(JSON.parse(run.outputJson));
  const event = getSqlite()
    .prepare("SELECT payload_json as payloadJson FROM events WHERE id = ?")
    .get(run.entityId) as { payloadJson: string | null } | undefined;
  const payload = parsePayload(event?.payloadJson ?? null);
  const email = normalizeEmail(output.email) || normalizeEmail(payload.from);

  if (!email) return null;

  const existing = getSqlite()
    .prepare(
      `
      SELECT targets.id
      FROM targets
      INNER JOIN contacts ON contacts.id = targets.contact_id
      WHERE lower(contacts.email) = ?
      LIMIT 1
    `
    )
    .get(email) as { id: string } | undefined;

  if (existing) {
    setReviewStatus(run.id, "applied");
    return existing.id;
  }

  const targetId = captureLead({
    runId: run.id,
    eventId: run.entityId,
    email,
    output,
    now: new Date().toISOString()
  });
  setReviewStatus(run.id, "applied");
  return targetId;
}

function captureLead({
  runId,
  eventId,
  email,
  output,
  now
}: {
  runId: string;
  eventId: string;
  email: string;
  output: UnlinkedLeadOutput;
  now: string;
}) {
  const domain = email.split("@")[1] ?? "";
  const accountDomain = CONSUMER_DOMAINS.has(domain) ? "" : normalizeDomain(domain);
  const company =
    output.company?.trim() ||
    (accountDomain ? titleFromDomain(accountDomain) : "") ||
    output.personName?.trim() ||
    email.split("@")[0];
  const targetId = createId("target");
  const contactId = createId("contact");

  getSqlite().transaction(() => {
    const accountId = accountDomain
      ? findOrCreateAccount({
          sqlite: getSqlite(),
          name: company,
          domain: accountDomain,
          now
        })
      : null;

    getSqlite()
      .prepare(
        `
        INSERT INTO contacts (
          id, account_id, name, email, domain, title, notes, tags,
          email_verification_provider, email_verification_status,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, ?, 'inbound', 'emaillistverify', 'pending', ?, ?)
      `
      )
      .run(
        contactId,
        accountId,
        output.personName?.trim() || company,
        email,
        accountDomain || domain || "unknown",
        output.need,
        now,
        now
      );

    getSqlite()
      .prepare(
        `
        INSERT INTO targets (
          id, contact_id, account_id, company_name, website_url, source_type,
          source_url, dedupe_key, status, stage, do_not_resend, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, NULL, 'inbound_email', NULL, ?, 'replied', 'replied', 0, ?, ?)
      `
      )
      .run(
        targetId,
        contactId,
        accountId,
        company,
        emailDedupeKey(email),
        now,
        now
      );
  })();

  recordEvent({
    entityType: "target",
    entityId: targetId,
    eventType: "ai_lead_captured",
    payload: {
      runId,
      eventId,
      email,
      kind: output.kind,
      confidence: output.confidence,
      summary: output.summary,
      need: output.need
    }
  });

  return targetId;
}

function parsePayload(value: string | null) {
  if (!value) return {} as Record<string, string | undefined>;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return {};
    return {
      messageId: stringValue(Reflect.get(parsed, "messageId")),
      subject: stringValue(Reflect.get(parsed, "subject")),
      from: stringValue(Reflect.get(parsed, "from")),
      to: stringValue(Reflect.get(parsed, "to")),
      bodyText: stringValue(Reflect.get(parsed, "bodyText"))
    };
  } catch {
    return {};
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function normalizeEmail(value: string | null | undefined) {
  const match = value?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0].toLowerCase() ?? "";
}

function isAutomatedAddress(email: string) {
  const local = email.split("@")[0] ?? "";
  return AUTOMATED_LOCAL_PARTS.has(local.toLowerCase());
}

function existingContact(email: string) {
  return Boolean(
    getSqlite().prepare("SELECT 1 FROM contacts WHERE lower(email) = ?").get(email)
  );
}

function existingTarget(email: string) {
  return Boolean(
    getSqlite()
      .prepare("SELECT 1 FROM targets WHERE dedupe_key = ? OR contact_id IN (SELECT id FROM contacts WHERE lower(email) = ?)")
      .get(emailDedupeKey(email), email)
  );
}

function titleFromDomain(domain: string) {
  const brand = domain.split(".")[0] ?? "";
  if (!brand) return "";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}
