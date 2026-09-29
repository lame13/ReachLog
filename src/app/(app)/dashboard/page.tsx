import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MailCheck,
  Send
} from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { SendEmailModal } from "@/components/send-email-modal";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime, timeAgo } from "@/modules/core/dates";
import { getDashboardData, getSendTarget } from "@/modules/outreach/queries";
import { getPipelineSummary } from "@/modules/pipeline/queries";
import { pipelineStages } from "@/modules/pipeline/stages";
import { markDeadAction, snoozeFollowupAction } from "@/modules/followups/actions";
import { isTargetActionBlocked } from "@/modules/outreach/status";
import { isEmailVerificationBlocking } from "@/modules/emailVerification/service";
import { resolveSendAnomalyAction } from "@/modules/smtp/anomaly-actions";
import { completeAcceptedSendAction } from "@/modules/smtp/actions";
import { getSendFeedback } from "@/modules/smtp/feedback";

const sendStatusLabels: Record<string, string> = {
  failed: "send failed",
  smtp_accepted_persist_failed: "not saved"
};

type PageProps = {
  searchParams?: Promise<{
    sendTargetId?: string;
    sendStatus?: string;
    sendMessage?: string;
  }>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const data = getDashboardData();
  const pipeline = getPipelineSummary();
  const sendTarget = getSendTarget(params?.sendTargetId);
  const sendFeedback = getSendFeedback(params);

  if (!data.stats.totalTargets) {
    return (
      <section className="max-w-2xl rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Start tracking your outreach</h1>
        <p className="mt-3 text-sm text-muted">
          Add someone you want to contact, or import your existing list. Replies and follow-ups will appear here.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white" href="/targets?showCreate=1">Add your first target</Link>
          <Link className="rounded-md border border-line px-4 py-2 text-sm font-medium" href="/import">Import a CSV</Link>
        </div>
        <p className="mt-5 text-sm text-muted">You can track outreach without connecting email. Set up sending and mailbox sync in Settings when you need them.</p>
      </section>
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            See who replied and who needs a follow-up.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={MailCheck}
          label="Replies needing action"
          tone="green"
          value={data.stats.repliesNeedingAction}
        />
        <MetricCard
          icon={Clock3}
          label="Follow-ups due"
          tone="amber"
          value={data.stats.followupsDue}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Overdue follow-ups"
          tone="rose"
          value={data.stats.overdueFollowups}
        />
        <MetricCard
          icon={Send}
          label="Sent, no reply"
          value={data.stats.sentNoReply}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Sending needs review"
          tone="rose"
          value={data.stats.failedSends}
        />
      </div>

      <section className="mt-6 rounded-lg border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-semibold">Pipeline</h2>
            <p className="mt-1 text-xs text-muted">
              {pipeline.open} open · {pipeline.won} won · {pipeline.lost} lost ·{" "}
              {pipeline.accounts} account{pipeline.accounts === 1 ? "" : "s"}
            </p>
          </div>
          <Link className="text-sm font-medium text-accent" href="/pipeline">
            Open pipeline
          </Link>
        </div>
        <div className="grid gap-2 px-4 py-3 sm:grid-cols-4 xl:grid-cols-7">
          {pipelineStages.map((stage) => (
            <Link
              className="rounded-md border border-line px-3 py-2 transition hover:bg-panel"
              href={`/pipeline?stage=${stage.key}`}
              key={stage.key}
            >
              <div className="text-xs text-muted">{stage.label}</div>
              <div className="mt-1 text-xl font-semibold">
                {pipeline.byStage[stage.key]}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {sendFeedback && !sendTarget && (
        <p
          role="status"
          className={`mt-6 rounded-lg border p-4 text-sm ${
            sendFeedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : sendFeedback.tone === "info"
                ? "border-sky-200 bg-sky-50 text-sky-900"
                : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          {sendFeedback.message}
        </p>
      )}

      {data.failedSends.length > 0 && (
        <section className="mt-6 rounded-lg border border-rose-200 bg-white shadow-sm">
          <div className="border-b border-rose-100 px-4 py-3">
            <h2 className="font-semibold text-rose-800">Sending needs review</h2>
            <p className="mt-1 text-sm text-rose-900">
              A message your mail server accepted but ReachLog could not save is
              listed as not saved. Save it to history to record it without
              sending again, or mark it checked once you have handled it another
              way. Sending to that contact stays blocked until you do.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[820px] text-sm">
              <thead className="bg-rose-50 text-left text-rose-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">To</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Error</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.failedSends.map((send) => (
                  <tr key={send.id} className="border-t border-line align-top">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/targets/${send.targetId}`}>
                        {send.companyName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted">{send.toEmail}</td>
                    <td className="px-4 py-3">{send.subject}</td>
                    <td className="px-4 py-3">
                      <StatusPill
                        status={sendStatusLabels[send.status] ?? send.status}
                      />
                    </td>
                    <td className="px-4 py-3 text-rose-700">
                      {send.lastError ?? "unknown"}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {formatDateTime(send.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {send.status === "smtp_accepted_persist_failed" && (
                          <form action={completeAcceptedSendAction}>
                            <input
                              name="outboundSendId"
                              type="hidden"
                              value={send.id}
                            />
                            <input
                              name="targetId"
                              type="hidden"
                              value={send.targetId}
                            />
                            <button className="h-9 rounded-md bg-ink px-3 text-xs font-medium text-white">
                              Save to history
                            </button>
                          </form>
                        )}
                        <form action={resolveSendAnomalyAction}>
                          <input
                            name="outboundSendId"
                            type="hidden"
                            value={send.id}
                          />
                          <input
                            name="targetId"
                            type="hidden"
                            value={send.targetId}
                          />
                          <button className="h-9 rounded-md border border-rose-200 px-3 text-xs font-medium text-rose-800 hover:bg-rose-50">
                            Mark checked
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-line bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">Replies needing action</h2>
          <Link className="text-sm font-medium text-accent" href="/targets">
            View targets
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[720px] text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Last reply</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.replies.map((reply) => (
                <tr key={reply.threadId} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/targets/${reply.targetId}`}>
                      {reply.companyName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {reply.contactEmail ?? "form only"}
                  </td>
                  <td className="px-4 py-3">{timeAgo(reply.lastInboundAt)}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={reply.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-line bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">Follow-ups due</h2>
          <Link className="text-sm font-medium text-accent" href="/followups">
            Open queue
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[860px] text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Due</th>
                <th className="px-4 py-3 font-medium">Last touch</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.followups.map((followup) => {
                const canSend =
                  Boolean(followup.contactEmail) &&
                  !isTargetActionBlocked({
                    companyName: followup.companyName,
                    dedupeKey: followup.dedupeKey,
                    doNotResend: followup.doNotResend,
                    sourceType: followup.sourceType,
                    sourceUrl: followup.sourceUrl,
                    status: followup.targetStatus
                  }) &&
                  !isEmailVerificationBlocking(followup.emailVerificationStatus);

                return (
                <tr key={followup.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/targets/${followup.targetId}`}>
                      {followup.companyName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{formatDateTime(followup.dueAt)}</td>
                  <td className="px-4 py-3 text-muted">
                    {followup.lastOutboundAt
                      ? `email sent ${timeAgo(followup.lastOutboundAt)}`
                      : "form submitted"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {canSend ? (
                        <Link
                          className="inline-flex h-9 items-center rounded-md bg-ink px-3 text-xs font-medium text-white"
                          href={`/dashboard?sendTargetId=${followup.targetId}`}
                        >
                          Send
                        </Link>
                      ) : (
                        <span className="inline-flex h-9 items-center rounded-md bg-gray-200 px-3 text-xs font-medium text-muted">
                          Send
                        </span>
                      )}
                      <form action={snoozeFollowupAction}>
                        <input name="followupId" type="hidden" value={followup.id} />
                        <input name="targetId" type="hidden" value={followup.targetId} />
                        <input name="days" type="hidden" value="3" />
                        <button className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                          Snooze
                        </button>
                      </form>
                      <form action={markDeadAction}>
                        <input name="followupId" type="hidden" value={followup.id} />
                        <input name="targetId" type="hidden" value={followup.targetId} />
                        <button className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                          Dead
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-line bg-white shadow-sm">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold">Recently Imported Mail</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[760px] text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Direction</th>
                <th className="px-4 py-3 font-medium">From/To</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">Linked</th>
              </tr>
            </thead>
            <tbody>
              {data.recentMessages.map((message) => (
                <tr key={message.id} className="border-t border-line">
                  <td className="px-4 py-3 capitalize">
                    <span className="inline-flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-emerald-700" />
                      {message.direction}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {message.direction === "inbound"
                      ? message.fromEmail
                      : message.toEmail}
                  </td>
                  <td className="px-4 py-3">{message.subject}</td>
                  <td className="px-4 py-3">
                    <Link href={`/targets/${message.targetId}`}>
                      {message.companyName}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SendEmailModal closeHref="/dashboard" feedback={sendFeedback} target={sendTarget} />
    </>
  );
}
