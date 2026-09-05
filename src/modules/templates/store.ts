import { z } from "zod";
import { getSqlite } from "../core/db/client";
import { createId } from "../core/ids";
import {
  templateVariables,
  unresolvedVariables,
  type EmailTemplate,
  type TemplateVariable,
} from "./render";

export class TemplateInputError extends Error {
  constructor(public readonly fields: Record<string, string>) {
    super("Check the highlighted template fields.");
  }
}
const templateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the template a name.")
    .max(100, "Use at most 100 characters."),
  subject: z
    .string()
    .trim()
    .min(1, "Enter a subject.")
    .max(300, "Use at most 300 characters.")
    .refine((value) => !/[\r\n]/.test(value), "Keep the subject on one line."),
  body: z
    .string()
    .min(1, "Enter a message.")
    .max(50000, "Use at most 50,000 characters.")
    .refine((value) => Boolean(value.trim()), "Enter a message."),
});

export function getTemplates() {
  return getSqlite()
    .prepare(
      "SELECT id, name, subject, body, created_at AS createdAt, updated_at AS updatedAt FROM email_templates ORDER BY name COLLATE NOCASE, id",
    )
    .all() as EmailTemplate[];
}

export function saveTemplate(
  id: string | null,
  input: { name: string; subject: string; body: string },
) {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success)
    throw new TemplateInputError(
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0]),
          issue.message,
        ]),
      ),
    );
  const errors: Record<string, string> = {};
  for (const field of ["subject", "body"] as const) {
    const unknown = unresolvedVariables(parsed.data[field]).filter(
      (key) => !templateVariables.includes(key as TemplateVariable),
    );
    if (unknown.length)
      errors[field] =
        `Unknown variables: ${unknown.join(", ")}. Use contact_name, company, email, or website.`;
  }
  if (Object.keys(errors).length) throw new TemplateInputError(errors);
  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const templateId = id || createId("template");
  try {
    if (id) {
      const result = sqlite
        .prepare(
          "UPDATE email_templates SET name = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?",
        )
        .run(parsed.data.name, parsed.data.subject, parsed.data.body, now, id);
      if (!result.changes)
        throw new Error("This template no longer exists. Refresh the page.");
    } else {
      sqlite
        .prepare(
          "INSERT INTO email_templates (id, name, subject, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          templateId,
          parsed.data.name,
          parsed.data.subject,
          parsed.data.body,
          now,
          now,
        );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "SQLITE_CONSTRAINT_UNIQUE"
    )
      throw new TemplateInputError({
        name: "A template with this name already exists.",
      });
    throw error;
  }
  return templateId;
}

export function deleteTemplate(id: string) {
  getSqlite().prepare("DELETE FROM email_templates WHERE id = ?").run(id);
}
