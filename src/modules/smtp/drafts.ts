import { getSqlite } from "@/modules/core/db/client";

export type EmailDraft = { subject: string; body: string; fromEmail: string };

export function saveEmailDraft(targetId: string, draft: EmailDraft) {
  getSqlite().prepare(`
    INSERT INTO email_drafts (target_id, subject, body, from_email, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(target_id) DO UPDATE SET
      subject = excluded.subject, body = excluded.body,
      from_email = excluded.from_email, updated_at = excluded.updated_at
  `).run(targetId, draft.subject, draft.body, draft.fromEmail, new Date().toISOString());
}

export function getEmailDraft(targetId: string): EmailDraft | null {
  return (getSqlite().prepare(
    "SELECT subject, body, from_email AS fromEmail FROM email_drafts WHERE target_id = ?"
  ).get(targetId) as EmailDraft | undefined) ?? null;
}

export function clearEmailDraft(targetId: string) {
  getSqlite().prepare("DELETE FROM email_drafts WHERE target_id = ?").run(targetId);
}
