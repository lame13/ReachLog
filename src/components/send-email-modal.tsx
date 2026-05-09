import Link from "next/link";
import { Save, Send, X } from "lucide-react";
import { saveDraftAction, sendNowAction } from "@/modules/smtp/actions";
import { formatDateTime } from "@/modules/core/dates";
import { createId } from "@/modules/core/ids";
import { isSendBlockedStatus } from "@/modules/outreach/status";

type SendTarget = {
  id: string;
  companyName: string;
  doNotResend: boolean;
  contactEmail: string | null;
  contactName: string | null;
  status: string;
  lastOutboundAt: string | null;
  subject: string | null;
};

export function SendEmailModal({
  target,
  closeHref
}: {
  target: SendTarget | null;
  closeHref: string;
}) {
  if (!target) {
    return null;
  }

  const subject = target.subject
    ? target.subject.startsWith("Re:")
      ? target.subject
      : `Re: ${target.subject}`
    : `Quick question about ${target.companyName}`;
  const blockedStatus = isSendBlockedStatus(target.status);
  const canSend = Boolean(target.contactEmail) && !target.doNotResend && !blockedStatus;
  const sendKey = createId("sendkey");

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-lg border border-line bg-white shadow-soft">
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

        <form className="space-y-4 p-5">
          <input type="hidden" name="targetId" value={target.id} />
          <input type="hidden" name="sendKey" value={sendKey} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium">To</span>
            <input
              className="h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-accent"
              name="to"
              readOnly
              value={target.contactEmail ?? "No email on target"}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Subject</span>
            <input
              className="h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-accent"
              name="subject"
              defaultValue={subject}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Body</span>
            <textarea
              className="min-h-48 w-full resize-y rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
              name="body"
              defaultValue="Hi, just wanted to follow up on this."
            />
          </label>

          <div className="rounded-md border border-line bg-panel p-3 text-sm text-muted">
            <div>Last outbound: {formatDateTime(target.lastOutboundAt)}</div>
            <div>Status: {target.status}</div>
            <div>Do not resend: {target.doNotResend ? "on" : "off"}</div>
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
                defaultValue={3}
              />
            </label>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              formAction={saveDraftAction}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium hover:bg-panel"
              type="submit"
            >
              <Save className="size-4" aria-hidden="true" />
              Save draft
            </button>
            <button
              formAction={sendNowAction}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              disabled={!canSend}
              type="submit"
            >
              <Send className="size-4" aria-hidden="true" />
              Send now
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
