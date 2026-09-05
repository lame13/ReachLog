import Link from "next/link";
import { X } from "lucide-react";
import { EmailComposerFields } from "./email-composer-fields";
import { getTemplates } from "@/modules/templates/store";
import { sendNowAction } from "@/modules/smtp/actions";
import { formatDateTime } from "@/modules/core/dates";
import { createId } from "@/modules/core/ids";
import {
  isDoNotResendHardBlock,
  isTargetActionBlocked
} from "@/modules/outreach/status";
import { isEmailVerificationBlocking } from "@/modules/emailVerification/service";
import {
  getSmtpFromOptions,
  selectPreferredSmtpFrom
} from "@/modules/smtp/from-identities";
import type { SendFeedback } from "@/modules/smtp/feedback";
import type { EmailDraft } from "@/modules/smtp/drafts";

type SendTarget = {
  id: string;
  companyName: string;
  dedupeKey: string;
  doNotResend: boolean;
  sourceType: string;
  sourceUrl: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  emailVerificationStatus: string | null;
  emailVerificationCheckedAt: string | null;
  emailVerificationError: string | null;
  contactName: string | null;
  status: string;
  lastOutboundAt: string | null;
  lastOutboundFrom: string | null;
  lastOutboundBody: string | null;
  subject: string | null;
  draft: EmailDraft | null;
};

export function SendEmailModal({
  target,
  closeHref,
  feedback
}: {
  target: SendTarget | null;
  closeHref: string;
  feedback?: SendFeedback | null;
}) {
  if (!target) {
    return null;
  }

  const subject = target.draft?.subject ?? (target.subject
    ? target.subject.startsWith("Re:")
      ? target.subject
      : `Re: ${target.subject}`
    : `Quick question about ${target.companyName}`);
  const blockedEmailVerification = isEmailVerificationBlocking(
    target.emailVerificationStatus
  );
  const blockedDoNotResend = isDoNotResendHardBlock(target);
  const blockedTarget = isTargetActionBlocked(target);
  const canSend =
    Boolean(target.contactEmail) &&
    !blockedTarget &&
    !blockedEmailVerification;
  const cannotSendMessage = getCannotSendMessage({
    hasEmail: Boolean(target.contactEmail),
    doNotResend: blockedDoNotResend,
    targetBlocked: blockedTarget,
    emailVerificationBlocked: blockedEmailVerification,
    emailVerificationStatus: target.emailVerificationStatus
  });
  const fromOptions = getSmtpFromOptions();
  const selectedFrom = fromOptions.some((option) => option.value === target.draft?.fromEmail)
    ? target.draft!.fromEmail
    : selectPreferredSmtpFrom(target);
  const sendKey = createId("sendkey");

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/40 px-4 py-6">
      <div className="mx-auto flex min-h-full w-full max-w-2xl items-center">
        <div className="my-auto max-h-[calc(100vh-3rem)] w-full overflow-hidden rounded-lg border border-line bg-white shadow-soft">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Send Email</h2>
            <p className="text-sm text-muted">{target.companyName}</p>
          </div>
          <Link
            href={closeHref}
            className="grid size-9 place-items-center rounded-md text-muted hover:bg-panel hover:text-ink"
            aria-label="Close send modal"
          >
            <X className="size-4" aria-hidden="true" />
          </Link>
        </div>

        <form action={sendNowAction} className="max-h-[calc(100vh-8.5rem)] space-y-4 overflow-y-auto p-5">
          {feedback && (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                feedback.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : feedback.tone === "info"
                    ? "border-sky-200 bg-sky-50 text-sky-800"
                    : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              {feedback.message}
            </div>
          )}
          {!canSend && cannotSendMessage && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {cannotSendMessage}
            </div>
          )}
          <input type="hidden" name="targetId" value={target.id} />
          <input type="hidden" name="sendKey" value={sendKey} />
          <input type="hidden" name="returnTo" value={closeHref} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium">From</span>
            {fromOptions.length > 1 ? (
              <select
                className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-accent"
                name="fromEmail"
                defaultValue={selectedFrom}
              >
                {fromOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input name="fromEmail" type="hidden" value={selectedFrom} />
                <input
                  className="h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-accent"
                  readOnly
                  value={
                    fromOptions.find((option) => option.value === selectedFrom)?.label ??
                    fromOptions[0].label
                  }
                />
              </>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">To</span>
            <input
              className="h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-accent"
              name="to"
              readOnly
              value={target.contactEmail ?? "No email on target"}
            />
          </label>
          <EmailComposerFields
            initial={{ subject, body: target.draft?.body ?? target.lastOutboundBody ?? "" }}
            templates={getTemplates()}
            context={{ contact_name: target.contactName, company: target.companyName, email: target.contactEmail, website: target.websiteUrl }}
            canSend={canSend}
          >
          <div className="rounded-md border border-line bg-panel p-3 text-sm text-muted">
            <div>Last outbound: {formatDateTime(target.lastOutboundAt)}</div>
            <div>Status: {target.status}</div>
            <div>
              Email verification: {target.emailVerificationStatus ?? "not checked"}
              {target.emailVerificationCheckedAt
                ? ` at ${formatDateTime(target.emailVerificationCheckedAt)}`
                : ""}
            </div>
            {target.emailVerificationError && (
              <div>Email verification error: {target.emailVerificationError}</div>
            )}
            <div>Do not resend: {target.doNotResend ? "on" : "off"}</div>
            {target.doNotResend && !blockedDoNotResend && (
              <div>Do not resend is treated as dedupe-only for this active/replied thread.</div>
            )}
          </div>

          <div className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-[1fr_120px]">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                className="size-4 accent-accent"
                defaultChecked
                name="createFollowup"
                type="checkbox"
              />
              Create next follow-up
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Days</span>
              <input
                className="h-9 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-accent"
                min={1}
                name="followupDays"
                type="number"
                defaultValue={5}
              />
            </label>
          </div>

          </EmailComposerFields>
        </form>
      </div>
      </div>
    </div>
  );
}

function getCannotSendMessage({
  hasEmail,
  doNotResend,
  targetBlocked,
  emailVerificationBlocked,
  emailVerificationStatus
}: {
  hasEmail: boolean;
  doNotResend: boolean;
  targetBlocked: boolean;
  emailVerificationBlocked: boolean;
  emailVerificationStatus: string | null;
}) {
  if (!hasEmail) {
    return "Send is disabled because this target has no email address.";
  }

  if (doNotResend) {
    return "Send is disabled because this target is marked Do Not Resend and is not an active/replied thread.";
  }

  if (targetBlocked) {
    return "Send is disabled because this target is blocked by status or source.";
  }

  if (emailVerificationBlocked) {
    return `Send is disabled because email verification returned ${emailVerificationStatus ?? "a blocking status"}.`;
  }

  return "";
}
