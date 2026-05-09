"use server";

import { revalidatePath } from "next/cache";
import { getSqlite } from "@/modules/core/db/client";
import { createId } from "@/modules/core/ids";
import {
  contactFormDedupeKey,
  domainDedupeKey,
  emailDedupeKey,
  normalizeDomain,
  sourceDedupeKey
} from "@/modules/outreach/dedupe";
import { isSendBlockedStatus } from "@/modules/outreach/status";

export type ImportPreviewResult =
  | "new target"
  | "duplicate target"
  | "duplicate contact"
  | "duplicate domain warning"
  | "duplicate in file"
  | "invalid";

export type ImportPreviewRow = {
  rowNumber: number;
  companyName: string;
  name: string;
  email: string;
  domain: string;
  websiteUrl: string;
  sourceType: string;
  sourceUrl: string;
  formUrl: string;
  subject: string;
  messageText: string;
  notes: string;
  dedupeKey: string;
  status: string;
  nextAction: string;
  followUpDate: string;
  sourceTimestamp: string;
  doNotResend: boolean;
  dedupeOnlyDoNotResend: boolean;
  result: ImportPreviewResult;
  reason: string;
};

export type ImportActionState = {
  csvText: string;
  rows: ImportPreviewRow[];
  summary: {
    total: number;
    importable: number;
    skipped: number;
    warnings: number;
    inserted: number;
  };
  message: string | null;
  error: string | null;
};

export const initialImportState: ImportActionState = {
  csvText: "",
  rows: [],
  summary: {
    total: 0,
    importable: 0,
    skipped: 0,
    warnings: 0,
    inserted: 0
  },
  message: null,
  error: null
};

export async function previewCsvImportAction(
  _previousState: ImportActionState,
  formData: FormData
): Promise<ImportActionState> {
  const csvText = await getCsvText(formData);

  if (!csvText.trim()) {
    return {
      ...initialImportState,
      error: "Paste CSV text or choose a CSV file."
    };
  }

  try {
    const rows = buildPreviewRows(csvText);
    return {
      csvText,
      rows,
      summary: summarizeRows(rows, 0),
      message: rows.length ? "Preview ready. Review duplicates before import." : null,
      error: rows.length ? null : "No importable CSV rows found."
    };
  } catch (error) {
    return {
      ...initialImportState,
      csvText,
      error: error instanceof Error ? error.message : "Could not parse CSV."
    };
  }
}

export async function commitCsvImportAction(
  _previousState: ImportActionState,
  formData: FormData
): Promise<ImportActionState> {
  const csvText = await getCsvText(formData);

  if (!csvText.trim()) {
    return {
      ...initialImportState,
      error: "Nothing to import."
    };
  }

  try {
    const rows = buildPreviewRows(csvText);
    const importableRows = rows.filter(isImportableRow);
    const inserted = insertImportRows(importableRows);

    revalidatePath("/dashboard");
    revalidatePath("/targets");
    revalidatePath("/analytics");
    revalidatePath("/import");

    return {
      csvText,
      rows: buildPreviewRows(csvText),
      summary: summarizeRows(rows, inserted),
      message: `Imported ${inserted} target${inserted === 1 ? "" : "s"}.`,
      error: null
    };
  } catch (error) {
    return {
      ...initialImportState,
      csvText,
      error: error instanceof Error ? error.message : "Import failed."
    };
  }
}

async function getCsvText(formData: FormData) {
  const rawText = String(formData.get("csvText") ?? "");
  const file = formData.get("csvFile");

  if (
    file &&
    typeof file === "object" &&
    "size" in file &&
    "text" in file &&
    Number(file.size) > 0
  ) {
    return String(await file.text());
  }

  return rawText;
}

function buildPreviewRows(csvText: string) {
  const parsedRows = parseCsv(csvText);

  if (parsedRows.length < 2) {
    throw new Error("CSV needs a header row and at least one data row.");
  }

  const [headers, ...records] = parsedRows;
  const normalizedHeaders = headers.map(normalizeHeader);
  assertSupportedImportHeaders(normalizedHeaders);
  const seenKeys = new Set<string>();

  return records
    .map((record, index) =>
      normalizeImportRow(normalizedHeaders, record, index + 2, seenKeys)
    )
    .filter((row) => row.companyName || row.email || row.websiteUrl || row.sourceUrl);
}

function assertSupportedImportHeaders(headers: string[]) {
  const isPlatformStatusCsv =
    headers.includes("date_recorded") &&
    headers.includes("platform") &&
    headers.includes("action_completed");

  if (isPlatformStatusCsv) {
    throw new Error(
      "This looks like a platform status tracker CSV. Do not import it through target import yet."
    );
  }

  const unsupportedTrackerImports = [
    {
      name: "marketplace bids",
      columns: ["project_title"]
    },
    {
      name: "WP.org threads",
      columns: ["thread_title"]
    },
    {
      name: "platform statuses",
      columns: ["platform_status"]
    }
  ];

  const match = unsupportedTrackerImports.find((candidate) =>
    candidate.columns.some((column) => headers.includes(column))
  );

  if (!match) {
    return;
  }

  throw new Error(
    `This looks like a ${match.name} tracker CSV. Import only outreach log, dedupe index, or queue status CSVs here for now.`
  );
}

function normalizeImportRow(
  headers: string[],
  record: string[],
  rowNumber: number,
  seenKeys: Set<string>
): ImportPreviewRow {
  const value = (...names: string[]) => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index >= 0) {
        return (record[index] ?? "").trim();
      }
    }

    return "";
  };

  const contactType = value("contact_type").toLowerCase();
  const contactValue = value("contact_value");
  const isEmailContact =
    contactType === "email" ||
    (contactType.includes("email") && contactValue.includes("@"));
  const isFormContact = contactType.includes("form");
  const isThreadContact = contactType.includes("thread");
  const contactValueUrl = looksLikeUrl(contactValue) ? contactValue : "";
  const email = (
    value("email", "contact_email") ||
    (isEmailContact && contactValue.includes("@") ? contactValue : "")
  ).toLowerCase();
  const explicitSourceUrl = value(
    "source_url",
    "source_link",
    "thread_url",
    "project_url",
    "source_reference",
    "source_ref"
  );
  const formUrl =
    value("form_url", "contact_form_url") ||
    (isFormContact ? contactValueUrl || explicitSourceUrl : "");
  const sourceUrl =
    explicitSourceUrl || (!isEmailContact ? contactValueUrl : "") || formUrl;
  const websiteUrl =
    value("website_url", "website", "url") ||
    (!isFormContact && !isThreadContact && contactValueUrl ? contactValueUrl : "");
  const sourceType = isFormContact
    ? "contact_form"
    : value("source_type", "source", "source_group", "channel") || "csv";
  const name = value("name", "contact_name");
  const subject = value("subject", "subject_or_form_context");
  const messageText = value(
    "message_text",
    "message",
    "body",
    "message_text_or_summary",
    "reply_text_or_summary"
  );
  const notes = value("notes", "note");
  const domain =
    value("domain", "domain_key") || inferDomain(email, websiteUrl, sourceUrl, formUrl);
  const companyName =
    value("company_name", "company", "account", "target") ||
    (domain ? domain.split(".")[0] : email || "Unknown target");
  const followUpDate = value("follow_up_date", "followup_date", "next_follow_up");
  const sourceTimestamp = parseSourceTimestamp(
    firstNonEmpty(
      value("date_sent"),
      value("date_posted"),
      value("date_updated"),
      value("date_recorded")
    )
  ) ?? "";
  const nextAction = value("next_action");
  const rawDoNotResend = parseBoolean(value("do_not_resend", "do_not_contact"));
  const status =
    value("status") ||
    inferStatus({ followUpDate, nextAction, dedupeProtected: rawDoNotResend, sourceType });
  const doNotResend = shouldImportHardSendBlock({
    rawDoNotResend,
    status,
    nextAction
  });
  const dedupeOnlyDoNotResend = rawDoNotResend && !doNotResend;
  const dedupeKey = value("dedupe_key") || inferDedupeKey({
    email,
    domain,
    sourceType,
    sourceUrl,
    formUrl
  });

  if (companyName === "Unknown target" && !email && !websiteUrl && !sourceUrl) {
    return {
      rowNumber,
      companyName,
      name,
      email,
      domain,
      websiteUrl,
      sourceType,
      sourceUrl,
      formUrl,
      subject,
      messageText,
      notes,
      dedupeKey,
      status,
      nextAction,
      followUpDate,
      sourceTimestamp,
      doNotResend,
      dedupeOnlyDoNotResend,
      result: "invalid",
      reason: "No target, email, website, source URL, or form URL to import."
    };
  }

  if (!dedupeKey) {
    return {
      rowNumber,
      companyName,
      name,
      email,
      domain,
      websiteUrl,
      sourceType,
      sourceUrl,
      formUrl,
      subject,
      messageText,
      notes,
      dedupeKey: "",
      status,
      nextAction,
      followUpDate,
      sourceTimestamp,
      doNotResend,
      dedupeOnlyDoNotResend,
      result: "invalid",
      reason: "No email, website, source URL, or form URL to dedupe."
    };
  }

  if (seenKeys.has(dedupeKey)) {
    return {
      rowNumber,
      companyName,
      name,
      email,
      domain,
      websiteUrl,
      sourceType,
      sourceUrl,
      formUrl,
      subject,
      messageText,
      notes,
      dedupeKey,
      status,
      nextAction,
      followUpDate,
      sourceTimestamp,
      doNotResend,
      dedupeOnlyDoNotResend,
      result: "duplicate in file",
      reason: "Another row in this CSV has the same dedupe key."
    };
  }

  seenKeys.add(dedupeKey);

  const dedupe = checkDatabaseDedupe({ email, domain, dedupeKey });

  return {
    rowNumber,
    companyName,
    name,
    email,
    domain,
    websiteUrl,
    sourceType,
    sourceUrl,
    formUrl,
    subject,
    messageText,
    notes,
    dedupeKey,
    status,
    nextAction,
    followUpDate,
    sourceTimestamp,
    doNotResend,
    dedupeOnlyDoNotResend,
    result: dedupe.result,
    reason: dedupeOnlyDoNotResend
      ? `${dedupe.reason} CSV do_not_resend is kept as dedupe-only protection.`
      : dedupe.reason
  };
}

function checkDatabaseDedupe({
  email,
  domain,
  dedupeKey
}: {
  email: string;
  domain: string;
  dedupeKey: string;
}) {
  const sqlite = getSqlite();

  const targetExists = sqlite
    .prepare("SELECT id FROM targets WHERE dedupe_key = ?")
    .get(dedupeKey);

  if (targetExists) {
    return {
      result: "duplicate target" as const,
      reason: "A target already has this dedupe key."
    };
  }

  if (email) {
    const contactExists = sqlite
      .prepare("SELECT id FROM contacts WHERE email = ?")
      .get(email);

    if (contactExists) {
      return {
        result: "duplicate contact" as const,
        reason: "A contact already exists for this email."
      };
    }
  }

  if (domain) {
    const domainExists = sqlite
      .prepare(
        `
        SELECT targets.id
        FROM targets
        LEFT JOIN contacts ON contacts.id = targets.contact_id
        WHERE contacts.domain = ?
           OR targets.website_url LIKE ?
        LIMIT 1
      `
      )
      .get(domain, `%${domain}%`);

    if (domainExists) {
      return {
        result: "duplicate domain warning" as const,
        reason: "No exact duplicate, but this domain is already present."
      };
    }
  }

  return {
    result: "new target" as const,
    reason: "No duplicate found."
  };
}

function insertImportRows(rows: ImportPreviewRow[]) {
  if (!rows.length) {
    return 0;
  }

  const sqlite = getSqlite();
  const now = new Date().toISOString();
  let inserted = 0;

  const transaction = sqlite.transaction(() => {
    for (const row of rows) {
      const targetExists = sqlite
        .prepare("SELECT id FROM targets WHERE dedupe_key = ?")
        .get(row.dedupeKey);

      if (targetExists) {
        continue;
      }

      const sourceAt = row.sourceTimestamp || now;
      const contactId = row.email
        ? upsertContact({
            email: row.email,
            name: row.name || row.companyName,
            domain: row.domain,
            now: sourceAt
          })
        : null;
      const targetId = createId("target");
      const status = row.status || (row.sourceType === "contact_form" ? "form submitted" : "new");

      sqlite
        .prepare(
          `
          INSERT INTO targets (
            id, contact_id, company_name, website_url, source_type, source_url,
            dedupe_key, status, do_not_resend, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          targetId,
          contactId,
          row.companyName,
          row.websiteUrl || null,
          row.sourceType,
          row.sourceUrl || null,
          row.dedupeKey,
          status,
          row.doNotResend ? 1 : 0,
          sourceAt,
          sourceAt
        );

      createTargetEvent(targetId, "target_imported", row, now);
      createTargetEvent(targetId, "outreach_logged", row, sourceAt);

      if (row.sourceType === "contact_form" && row.formUrl) {
        const submittedAt = sourceAt;

        sqlite
          .prepare(
            `
            INSERT INTO contact_form_submissions (
              id, target_id, website_url, form_url, subject, message_text,
              submitted_at, dedupe_key, notes, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(dedupe_key) DO NOTHING
          `
          )
          .run(
            createId("form"),
            targetId,
            row.websiteUrl || `https://${row.domain}`,
            row.formUrl,
            row.subject || null,
            row.messageText || row.notes || row.nextAction || "Imported contact form outreach.",
            submittedAt,
            safeContactFormDedupeKey(row.formUrl),
            row.notes || null,
            now
          );

        createTargetEvent(targetId, "form_submitted", row, submittedAt);
      }

      const dueAt = parseFollowUpDate(row.followUpDate);

      if (dueAt && shouldCreateImportedFollowup(row)) {
        sqlite
          .prepare(
            `
            INSERT INTO followup_tasks (
              id, thread_id, target_id, due_at, status, suggested_subject,
              suggested_body, notification_sent_at, notification_channel,
              notification_status, completed_at, created_at
            )
            VALUES (?, NULL, ?, ?, 'open', ?, ?, NULL, NULL, NULL, NULL, ?)
          `
          )
          .run(
            createId("followup"),
            targetId,
            dueAt,
            row.subject || `Follow up with ${row.companyName}`,
            row.messageText || row.nextAction || "Follow up on this outreach.",
            now
          );

        createTargetEvent(targetId, "followup_created", row, now);
      }

      inserted += 1;
    }
  });

  transaction();
  return inserted;
}

function upsertContact({
  email,
  name,
  domain,
  now
}: {
  email: string;
  name: string;
  domain: string;
  now: string;
}) {
  const sqlite = getSqlite();
  const existing = sqlite
    .prepare("SELECT id FROM contacts WHERE email = ?")
    .get(email) as { id: string } | undefined;

  if (existing) {
    return existing.id;
  }

  const contactId = createId("contact");

  sqlite
    .prepare(
      `
      INSERT INTO contacts (id, name, email, domain, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    )
    .run(contactId, name, email, domain || email.split("@")[1] || "unknown", now, now);

  return contactId;
}

function createTargetEvent(
  targetId: string,
  eventType: string,
  row: ImportPreviewRow,
  now: string
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
      JSON.stringify({
        rowNumber: row.rowNumber,
        sourceType: row.sourceType,
        sourceUrl: row.sourceUrl || null,
        dedupeKey: row.dedupeKey,
        nextAction: row.nextAction || null,
        followUpDate: row.followUpDate || null,
        sourceTimestamp: row.sourceTimestamp || null,
        doNotResend: row.doNotResend,
        dedupeOnlyDoNotResend: row.dedupeOnlyDoNotResend
      }),
      now
    );
}

function summarizeRows(rows: ImportPreviewRow[], inserted: number) {
  const importable = rows.filter(isImportableRow).length;
  const warnings = rows.filter((row) => row.result === "duplicate domain warning")
    .length;

  return {
    total: rows.length,
    importable,
    skipped: rows.length - importable,
    warnings,
    inserted
  };
}

function isImportableRow(row: ImportPreviewRow) {
  return row.result === "new target" || row.result === "duplicate domain warning";
}

function parseCsv(csvText: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    const nextCharacter = csvText[index + 1];

    if (character === "\"") {
      if (inQuotes && nextCharacter === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += character;
  }

  row.push(field);
  rows.push(row);

  return rows.filter((candidate) =>
    candidate.some((value) => value.trim().length > 0)
  );
}

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function inferDomain(
  email: string,
  websiteUrl: string,
  sourceUrl: string,
  formUrl: string
) {
  if (email.includes("@")) {
    return email.split("@").pop() ?? "";
  }

  const url = websiteUrl || formUrl || sourceUrl;

  if (!url) {
    return "";
  }

  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return normalizeDomain(url);
  }
}

function inferDedupeKey({
  email,
  domain,
  sourceType,
  sourceUrl,
  formUrl
}: {
  email: string;
  domain: string;
  sourceType: string;
  sourceUrl: string;
  formUrl: string;
}) {
  if (email) {
    return emailDedupeKey(email);
  }

  if (sourceType === "contact_form" && formUrl) {
    try {
      return contactFormDedupeKey(formUrl);
    } catch {
      return sourceDedupeKey("form", formUrl);
    }
  }

  if (sourceUrl) {
    return sourceDedupeKey(sourceType, sourceUrl);
  }

  if (domain) {
    return domainDedupeKey(domain);
  }

  return "";
}

function safeContactFormDedupeKey(formUrl: string) {
  try {
    return contactFormDedupeKey(formUrl);
  } catch {
    return sourceDedupeKey("form", formUrl);
  }
}

function parseBoolean(value: string) {
  return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

function firstNonEmpty(...values: string[]) {
  return values.find((value) => value.trim()) ?? "";
}

function inferStatus({
  followUpDate,
  nextAction,
  dedupeProtected,
  sourceType
}: {
  followUpDate: string;
  nextAction: string;
  dedupeProtected: boolean;
  sourceType: string;
}) {
  if (followUpDate || nextAction.toLowerCase().includes("follow")) {
    return "follow-up due";
  }

  if (dedupeProtected) {
    return "dedupe protected";
  }

  if (sourceType === "contact_form") {
    return "form submitted";
  }

  return "new";
}

function shouldImportHardSendBlock({
  rawDoNotResend,
  status,
  nextAction
}: {
  rawDoNotResend: boolean;
  status: string;
  nextAction: string;
}) {
  if (!rawDoNotResend) {
    return false;
  }

  return isSendBlockedStatus(status) || hasExplicitHardBlockAction(nextAction);
}

function shouldCreateImportedFollowup(row: ImportPreviewRow) {
  const status = row.status.toLowerCase();
  const action = row.nextAction.toLowerCase();

  if (!row.followUpDate) {
    return false;
  }

  if (row.doNotResend) {
    return false;
  }

  if (isSendBlockedStatus(status)) {
    return false;
  }

  if (row.sourceType === "contact_form") {
    return false;
  }

  if (status.includes("followup_sent") || status.includes("follow-up_sent")) {
    return false;
  }

  if (status.includes("community_reply") || status.includes("sent via form")) {
    return false;
  }

  if (
    action.includes("monitor only") ||
    action.includes("do not debate") ||
    action.includes("do not pitch") ||
    action.includes("wait only") ||
    action.includes("no second follow-up") ||
    action.includes("unless they reply")
  ) {
    return false;
  }

  return true;
}

function hasExplicitHardBlockAction(nextAction: string) {
  const normalized = nextAction.toLowerCase();

  if (
    normalized.includes("unless they reply") ||
    normalized.includes("unless jane replies") ||
    normalized.includes("no second follow-up") ||
    normalized.includes("wait only") ||
    normalized.includes("monitor only")
  ) {
    return false;
  }

  return (
    normalized.includes("never send") ||
    normalized.includes("do not contact") ||
    normalized.includes("do not outreach") ||
    normalized.includes("dead") ||
    normalized.includes("bounced") ||
    normalized.includes("blocked")
  );
}

function parseSourceTimestamp(value: string) {
  return parseHistoricalTimestamp(value);
}

function parseFollowUpDate(value: string) {
  return parseHistoricalTimestamp(value);
}

function parseHistoricalTimestamp(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T09:00:00`).toISOString();
  }

  const parsed = new Date(trimmed);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}
