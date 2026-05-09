import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, FileText, Mail, Send } from "lucide-react";
import { SendEmailModal } from "@/components/send-email-modal";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime } from "@/modules/core/dates";
import { addTargetNoteAction, updateDoNotResendAction } from "@/modules/outreach/actions";
import { getSendTarget, getTargetDetail } from "@/modules/outreach/queries";
import { markDeadAction, snoozeFollowupAction } from "@/modules/followups/actions";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ sendTargetId?: string }>;
};

export default async function TargetDetailPage({
  params,
  searchParams
}: PageProps) {
  const { id } = await params;
  const urlParams = await searchParams;
  const detail = getTargetDetail(id);
  const sendTarget = getSendTarget(urlParams?.sendTargetId);

  if (!detail) {
    notFound();
  }

  const { target, threads, messages, followups, forms, timeline } = detail;

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
              <StatusPill status={target.status} />
              {target.doNotResend && <StatusPill status="do not resend" />}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
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
                {messages.map((message) => (
                  <article key={message.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-2">
                        <Mail className="size-4 text-muted" aria-hidden="true" />
                        <span className="font-medium capitalize">
                          {message.direction}
                        </span>
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
                ))}
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
            <div className="divide-y divide-line">
              {timeline.length ? (
                timeline.map((event) => {
                  const detailText = getEventDetail(event.payloadJson);

                  return (
                    <div key={event.id} className="px-4 py-3 text-sm">
                      <div className="font-medium">{event.eventType}</div>
                      <div className="text-muted">{formatDateTime(event.createdAt)}</div>
                      {detailText && (
                        <div className="mt-2 whitespace-pre-wrap text-muted">
                          {detailText}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="px-4 py-3 text-sm text-muted">No events yet.</div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Follow-up</h2>
            </div>
            <div className="divide-y divide-line">
              {followups.map((followup) => (
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
              ))}
            </div>
          </section>
        </aside>
      </div>

      <SendEmailModal closeHref={`/targets/${target.id}`} target={sendTarget} />
    </>
  );
}

function getEventDetail(payloadJson: string | null) {
  if (!payloadJson) {
    return null;
  }

  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const note = typeof payload.note === "string" ? payload.note : null;
    const reason = typeof payload.reason === "string" ? payload.reason : null;
    const messageId =
      typeof payload.messageId === "string" ? `message: ${payload.messageId}` : null;
    const dueAt =
      typeof payload.dueAt === "string"
        ? `next follow-up: ${formatDateTime(payload.dueAt)}`
        : null;

    return note ?? reason ?? messageId ?? dueAt;
  } catch {
    return null;
  }
}
