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
  doNotResend: boolean;
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
  const seenKeys = new Set<string>();

  return records
    .map((record, index) =>
      normalizeImportRow(normalizedHeaders, record, index + 2, seenKeys)
    )
    .filter((row) => row.companyName || row.email || row.websiteUrl || row.sourceUrl);
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
  const email = (
    value("email", "contact_email") ||
    (contactType === "email" ? contactValue : "")
  ).toLowerCase();
  const websiteUrl =
    value("website_url", "website", "url") ||
    (contactType === "website" && looksLikeUrl(contactValue) ? contactValue : "");
  const sourceType =
    value("source_type", "source", "source_group", "channel") ||
    (contactType === "form" || contactType === "contact_form" ? "contact_form" : "csv");
  const sourceUrl = value(
    "source_url",
    "source_link",
    "thread_url",
    "project_url",
    "source_reference",
    "source_ref"
  );
  const formUrl =
    value("form_url", "contact_form_url") ||
    (sourceType === "contact_form" && looksLikeUrl(contactValue) ? contactValue : "") ||
    sourceUrl;
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
  const nextAction = value("next_action");
  const doNotResend = parseBoolean(value("do_not_resend", "do_not_contact"));
  const status = value("status") || inferStatus({ followUpDate, nextAction, doNotResend, sourceType });
  const dedupeKey = value("dedupe_key") || inferDedupeKey({
    email,
    domain,
    sourceType,
    sourceUrl,
    formUrl
  });

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
      doNotResend,
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
      doNotResend,
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
    doNotResend,
    result: dedupe.result,
    reason: dedupe.reason
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

      const contactId = row.email
        ? upsertContact({
            email: row.email,
            name: row.name || row.companyName,
            domain: row.domain,
            now
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
          now,
          now
        );

      createTargetEvent(targetId, "target_created", row, now);

      if (row.sourceType === "contact_form" && row.formUrl && row.messageText) {
        const submittedAt = now;

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
            row.messageText,
            submittedAt,
            safeContactFormDedupeKey(row.formUrl),
            row.notes || null,
            now
          );

        createTargetEvent(targetId, "form_submitted", row, now);
      }

      const dueAt = parseFollowUpDate(row.followUpDate);

      if (dueAt && !row.doNotResend) {
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
        doNotResend: row.doNotResend
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

function inferStatus({
  followUpDate,
  nextAction,
  doNotResend,
  sourceType
}: {
  followUpDate: string;
  nextAction: string;
  doNotResend: boolean;
  sourceType: string;
}) {
  if (doNotResend) {
    return "dead";
  }

  if (followUpDate || nextAction.toLowerCase().includes("follow")) {
    return "follow-up due";
  }

  if (sourceType === "contact_form") {
    return "form submitted";
  }

  return "new";
}

function parseFollowUpDate(value: string) {
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
