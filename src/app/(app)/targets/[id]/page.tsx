import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, FileText, Mail, RefreshCw, Send } from "lucide-react";
import { SendEmailModal } from "@/components/send-email-modal";
import { StageMoveForm } from "@/components/stage-move-form";
import { StagePill } from "@/components/stage-pill";
import { StatusPill } from "@/components/status-pill";
import { TimelineList } from "@/components/timeline-list";
import { formatDateTime } from "@/modules/core/dates";
import { recheckContactEmailAction } from "@/modules/emailVerification/actions";
import {
  addTargetNoteAction,
  updateDoNotResendAction,
  updateTargetAction
} from "@/modules/outreach/actions";
import { getSendTarget, getTargetDetail } from "@/modules/outreach/queries";
import {
  completeFollowupAction,
  createFollowupAction,
  markDeadAction,
  snoozeFollowupAction
} from "@/modules/followups/actions";
import { getSendFeedback } from "@/modules/smtp/feedback";
import { pipelineStages } from "@/modules/pipeline/stages";
import { getTimeline } from "@/modules/timeline/events";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    sendTargetId?: string;
    sendStatus?: string;
    sendMessage?: string;
  }>;
};

export default async function TargetDetailPage({
  params,
  searchParams
}: PageProps) {
  const { id } = await params;
  const urlParams = await searchParams;
  const detail = getTargetDetail(id);
  const sendTarget = getSendTarget(urlParams?.sendTargetId);
  const sendFeedback = getSendFeedback(urlParams);

  if (!detail) {
    notFound();
  }

  const { target, threads, messages, followups, forms } = detail;
  const timeline = getTimeline({ targetIds: [target.id] });
  const tomorrow = getDateInputValue(1);
  const nextOpenFollowup = followups
    .filter((followup) => followup.status === "open")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];

  return (
    <>
      <div className="mb-6 rounded-lg border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{target.companyName}</h1>
            <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted">
              <span>{target.contactEmail ?? "form only"}</span>
              <span>{target.domain ?? "unknown domain"}</span>
              <span>source: {target.sourceType}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StagePill stage={target.stage} />
              <StatusPill status={target.status} />
              {target.doNotResend && <StatusPill status="do not resend" />}
            </div>
            {target.accountId && target.accountName && (
              <div className="mt-3 text-sm">
                <Link
                  className="text-accent hover:underline"
                  href={`/accounts/${target.accountId}`}
                >
                  {target.accountName}
                </Link>
                {target.contactId && (
                  <>
                    <span className="text-muted"> · </span>
                    <Link
                      className="text-accent hover:underline"
                      href={`/contacts/${target.contactId}`}
                    >
                      contact record
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-56">
              <StageMoveForm stage={target.stage} targetId={target.id} />
            </div>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white"
              href={`/targets/${target.id}?sendTargetId=${target.id}`}
            >
              <Send className="size-4" aria-hidden="true" />
              Send email
            </Link>
            <form action={updateDoNotResendAction}>
              <input name="targetId" type="hidden" value={target.id} />
              <input
                name="enabled"
                type="hidden"
                value={target.doNotResend ? "false" : "true"}
              />
              <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line px-3 text-sm font-medium hover:bg-panel">
                <Ban className="size-4" aria-hidden="true" />
                {target.doNotResend ? "Allow resend" : "Do not resend"}
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Thread</h2>
            </div>
            {threads.length > 0 ? (
              <div className="divide-y divide-line">
                {messages.map((message) => {
                  const isUnreadInbound =
                    message.direction === "inbound" && !message.readAt;

                  return (
                    <article
                      key={message.id}
                      className={`p-4 ${
                        isUnreadInbound
                          ? "border-l-4 border-sky-400 bg-sky-100"
                          : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="inline-flex items-center gap-2">
                          <Mail className="size-4 text-muted" aria-hidden="true" />
                          <span className="font-medium capitalize">
                            {message.direction}
                          </span>
                          {isUnreadInbound && (
                            <span className="rounded-md bg-sky-200 px-2 py-0.5 text-xs font-medium text-sky-900">
                              unread
                            </span>
                          )}
                          <span className="text-sm text-muted">
                            {formatDateTime(message.sentAt ?? message.receivedAt)}
                          </span>
                        </div>
                        <div className="text-sm text-muted">{message.subject}</div>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink">
                        {message.bodyText}
                      </p>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 text-sm text-muted">No email thread yet.</div>
            )}
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Contact Forms</h2>
            </div>
            <div className="divide-y divide-line">
              {forms.length > 0 ? (
                forms.map((form) => (
                  <div key={form.id} className="p-4 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div className="font-medium">{form.formUrl}</div>
                      <div className="text-muted">
                        {formatDateTime(form.submittedAt)}
                      </div>
                    </div>
                    <p className="mt-2 text-muted">{form.messageText}</p>
                    <div className="mt-2 font-mono text-xs text-muted">
                      {form.dedupeKey}
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-sm text-muted">No form submissions.</div>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Email Verification</h2>
            </div>
            <div className="space-y-3 p-4 text-sm">
              {target.contactEmail ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={target.emailVerificationStatus ?? "not checked"} />
                    <span className="text-muted">
                      {target.emailVerificationProvider ?? "emaillistverify"}
                    </span>
                  </div>
                  <div className="text-muted">
                    Checked: {formatDateTime(target.emailVerificationCheckedAt)}
                  </div>
                  {target.emailVerificationError && (
                    <div className="text-rose-700">{target.emailVerificationError}</div>
                  )}
                  <form action={recheckContactEmailAction}>
                    <input name="targetId" type="hidden" value={target.id} />
                    <input name="contactId" type="hidden" value={target.contactId ?? ""} />
                    <button className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                      <RefreshCw className="size-3.5" aria-hidden="true" />
                      Recheck email
                    </button>
                  </form>
                </>
              ) : (
                <div className="text-muted">No email on this target.</div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Edit Target</h2>
            </div>
            <form action={updateTargetAction} className="space-y-3 p-4">
              <input name="targetId" type="hidden" value={target.id} />
              <input name="contactId" type="hidden" value={target.contactId ?? ""} />
              <DetailField label="Company" name="companyName" required value={target.companyName} />
              <DetailField label="Contact name" name="contactName" value={target.contactName ?? ""} />
              <DetailField label="Email" name="email" type="email" value={target.contactEmail ?? ""} />
              <DetailField label="Website" name="websiteUrl" type="url" value={target.websiteUrl ?? ""} />
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailField label="Source" name="sourceType" value={target.sourceType} />
                <DetailField label="Status" name="status" value={target.status} />
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">
                  Pipeline stage
                </span>
                <select
                  className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-accent"
                  defaultValue={target.stage}
                  name="stage"
                >
                  {pipelineStages.map((stage) => (
                    <option key={stage.key} value={stage.key}>
                      {stage.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-muted">
                  Changing the stage updates the status above unless you edit the status
                  yourself in the same save.
                </span>
              </label>
              <DetailField
                label="Reply type"
                name="replyType"
                placeholder="resume_linkedin_requested"
                value=""
              />
              <label className="flex items-start gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm">
                <input
                  className="mt-0.5 size-4 accent-accent"
                  defaultChecked={Boolean(target.doNotResend)}
                  name="doNotResend"
                  type="checkbox"
                />
                <span>
                  <span className="block font-medium">Do not resend</span>
                  <span className="block text-xs text-muted">
                    Active/replied statuses stay actionable; dead/bounced/skipped statuses still block sending.
                  </span>
                </span>
              </label>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <DetailField
                  label="Next follow-up"
                  name="nextFollowupDate"
                  type="date"
                  value={getDateInputPart(nextOpenFollowup?.dueAt)}
                />
                <DetailField
                  label="Time"
                  name="nextFollowupTime"
                  type="time"
                  value={getTimeInputPart(nextOpenFollowup?.dueAt) || "09:00"}
                />
              </div>
              <DetailField label="Source URL" name="sourceUrl" type="url" value={target.sourceUrl ?? ""} />
              <DetailField label="Dedupe key" name="dedupeKey" value={target.dedupeKey} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Update note</span>
                <textarea
                  className="min-h-24 w-full resize-y rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                  name="note"
                  placeholder="Founder/CEO requested resume and LinkedIn..."
                />
              </label>
              <button className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                Save target
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Note</h2>
            </div>
            <form action={addTargetNoteAction} className="space-y-3 p-4">
              <input name="targetId" type="hidden" value={target.id} />
              <textarea
                className="min-h-28 w-full resize-y rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                name="note"
                placeholder="Add a private note"
              />
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                <FileText className="size-3.5" aria-hidden="true" />
                Save note
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Timeline</h2>
            </div>
            <TimelineList items={timeline} emptyLabel="No events yet." />
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Follow-up</h2>
            </div>
            <form action={createFollowupAction} className="space-y-3 border-b border-line p-4">
              <input name="targetId" type="hidden" value={target.id} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Thread</span>
                <select
                  className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-accent"
                  name="threadId"
                >
                  <option value="">No thread</option>
                  {threads.map((thread) => (
                    <option key={thread.id} value={thread.id}>
                      {thread.subject}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <DetailField label="Due date" name="dueDate" type="date" value={tomorrow} />
                <DetailField label="Time" name="dueTime" type="time" value="09:00" />
              </div>
              <DetailField
                label="Subject"
                name="suggestedSubject"
                value={threads[0]?.subject ? `Re: ${threads[0].subject.replace(/^Re:\s*/i, "")}` : ""}
              />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Body</span>
                <textarea
                  className="min-h-24 w-full resize-y rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                  name="suggestedBody"
                  defaultValue="Hi, just wanted to follow up on this."
                />
              </label>
              <button className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                Schedule follow-up
              </button>
            </form>
            <div className="divide-y divide-line">
              {followups.length ? (
                followups.map((followup) => (
                  <div key={followup.id} className="space-y-3 p-4 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <StatusPill status={followup.status} />
                      <span className="text-muted">
                        {formatDateTime(followup.dueAt)}
                      </span>
                    </div>
                    <div className="font-medium">{followup.suggestedSubject}</div>
                    <p className="text-muted">{followup.suggestedBody}</p>
                    {followup.status === "open" && (
                      <div className="flex flex-wrap gap-2">
                        <form action={completeFollowupAction}>
                          <input name="followupId" type="hidden" value={followup.id} />
                          <input name="targetId" type="hidden" value={target.id} />
                          <button className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                            Complete
                          </button>
                        </form>
                        <form action={snoozeFollowupAction}>
                          <input name="followupId" type="hidden" value={followup.id} />
                          <input name="targetId" type="hidden" value={target.id} />
                          <input name="days" type="hidden" value="3" />
                          <button className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                            Snooze
                          </button>
                        </form>
                        <form action={markDeadAction}>
                          <input name="followupId" type="hidden" value={followup.id} />
                          <input name="targetId" type="hidden" value={target.id} />
                          <button className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                            Dead
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="p-4 text-sm text-muted">No follow-ups yet.</div>
              )}
            </div>
          </section>
        </aside>
      </div>

      <SendEmailModal
        closeHref={`/targets/${target.id}`}
        feedback={sendFeedback}
        target={sendTarget}
      />
    </>
  );
}

function DetailField({
  label,
  name,
  value,
  type = "text",
  required = false,
  placeholder
}: {
  label: string;
  name: string;
  value: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input
        className="h-9 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-accent"
        defaultValue={value}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}

function getDateInputValue(daysFromNow: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

function getDateInputPart(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getTimeInputPart(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
