import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  MailCheck
} from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { SendEmailModal } from "@/components/send-email-modal";
import { StatusPill } from "@/components/status-pill";
import { formatDate, formatDateTime, timeAgo } from "@/modules/core/dates";
import { isEmailVerificationBlocking } from "@/modules/emailVerification/service";
import { completeNextStepAction } from "@/modules/opportunities/actions";
import {
  formatPipelineValue
} from "@/modules/opportunities/value";
import { getDashboardData, getSendTarget } from "@/modules/outreach/queries";
import { isTargetActionBlocked } from "@/modules/outreach/status";
import { getPipelineSummary } from "@/modules/pipeline/queries";
import { pipelineStages } from "@/modules/pipeline/stages";
import { markDeadAction, snoozeFollowupAction } from "@/modules/followups/actions";
import { resolveSendAnomalyAction } from "@/modules/smtp/anomaly-actions";
import { completeAcceptedSendAction } from "@/modules/smtp/actions";
import { getSendFeedback } from "@/modules/smtp/feedback";
import { getPendingAiReviewCount } from "@/modules/ai/review";

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

type WorkItem = {
  key: string;
  targetId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  kind: "reply" | "next_step" | "followup" | "stale";
  title: string;
  detail: string;
  timing: string;
  priority: number;
  followupId?: string;
  canSend?: boolean;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const data = getDashboardData();
  const pipeline = getPipelineSummary();
  const sendTarget = getSendTarget(params?.sendTargetId);
  const sendFeedback = getSendFeedback(params);
  const pendingAiReviews = getPendingAiReviewCount();

  if (!data.stats.totalTargets && !pendingAiReviews) {
    return (
      <section className="max-w-2xl rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Start with one conversation</h1>
        <p className="mt-3 text-sm text-muted">
          Add someone you want to contact or import an existing list. Replies,
          next steps and follow-ups will collect here.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white"
            href="/targets?showCreate=1"
          >
            Add your first target
          </Link>
          <Link
            className="rounded-md border border-line px-4 py-2 text-sm font-medium"
            href="/import"
          >
            Import a CSV
          </Link>
        </div>
      </section>
    );
  }

  const work = buildWorkQueue(data);
  const shownWork = work.slice(0, 12);
  const openValue = formatPipelineValue(pipeline.openValueByCurrency);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Today</h1>
        <p className="mt-1 text-sm text-muted">
          The conversations and decisions that need you now.
        </p>
      </div>

      {pendingAiReviews > 0 && (
        <Link
          className="mb-4 flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 hover:border-sky-300"
          href="/review"
        >
          <span>
            {pendingAiReviews} AI suggestion{pendingAiReviews === 1 ? "" : "s"}{" "}
            waiting for review.
          </span>
          <span className="font-medium">Review now</span>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={MailCheck}
          label="Replies to handle"
          tone="green"
          value={data.stats.repliesNeedingAction}
        />
        <MetricCard
          icon={CalendarClock}
          label="Next steps due"
          tone="amber"
          value={data.stats.nextStepsDue}
        />
        <MetricCard
          icon={Clock3}
          label="Follow-ups due"
          tone="amber"
          value={data.stats.followupsDue}
        />
        <MetricCard
          icon={CircleDollarSign}
          label="Open pipeline value"
          value={openValue}
        />
      </div>

      {sendFeedback && !sendTarget && (
        <p
          className={`mt-6 rounded-lg border p-4 text-sm ${
            sendFeedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : sendFeedback.tone === "info"
                ? "border-sky-200 bg-sky-50 text-sky-900"
                : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
          role="status"
        >
          {sendFeedback.message}
        </p>
      )}

      {data.failedSends.length > 0 && (
        <section className="mt-6 rounded-lg border border-rose-200 bg-white shadow-sm">
          <div className="border-b border-rose-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle
                className="size-4 text-rose-700"
                aria-hidden="true"
              />
              <h2 className="font-semibold text-rose-800">Sending needs review</h2>
            </div>
            <p className="mt-1 text-sm text-rose-900">
              Sending stays blocked until these messages are recorded or checked.
            </p>
          </div>
          <div className="divide-y divide-line">
            {data.failedSends.map((send) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                key={send.id}
              >
                <div>
                  <Link
                    className="font-medium hover:underline"
                    href={`/targets/${send.targetId}`}
                  >
                    {send.companyName}
                  </Link>
                  <div className="mt-1 text-muted">
                    {send.subject} · {send.toEmail}
                  </div>
                  <div className="mt-1 text-xs text-rose-700">
                    {sendStatusLabels[send.status] ?? send.status}:{" "}
                    {send.lastError ?? "unknown error"}
                  </div>
                </div>
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
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-semibold">Needs your attention</h2>
            <p className="mt-1 text-xs text-muted">
              Replies come first, then scheduled steps and stale opportunities.
            </p>
          </div>
          <span className="text-xs text-muted">
            {work.length} item{work.length === 1 ? "" : "s"}
          </span>
        </div>
        {shownWork.length ? (
          <div className="divide-y divide-line">
            {shownWork.map((item) => (
              <article
                className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
                key={item.key}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium ${workKindTone(item.kind)}`}
                    >
                      {workKindLabel(item.kind)}
                    </span>
                    <Link
                      className="font-medium hover:underline"
                      href={`/targets/${item.targetId}`}
                    >
                      {item.companyName}
                    </Link>
                    <span className="text-xs text-muted">{item.timing}</span>
                  </div>
                  <div className="mt-2 text-sm font-medium">{item.title}</div>
                  <p className="mt-1 text-sm text-muted">{item.detail}</p>
                  {item.contactEmail && (
                    <p className="mt-1 text-xs text-muted">{item.contactEmail}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.kind === "next_step" ? (
                    <>
                      <form action={completeNextStepAction}>
                        <input
                          name="targetId"
                          type="hidden"
                          value={item.targetId}
                        />
                        <button className="h-9 rounded-md bg-ink px-3 text-xs font-medium text-white">
                          Mark done
                        </button>
                      </form>
                      <Link
                        className="inline-flex h-9 items-center gap-1 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel"
                        href={`/targets/${item.targetId}#next-step`}
                      >
                        Plan next
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    </>
                  ) : item.kind === "followup" && item.canSend ? (
                    <>
                      <Link
                        className="inline-flex h-9 items-center rounded-md bg-ink px-3 text-xs font-medium text-white"
                        href={`/dashboard?sendTargetId=${item.targetId}`}
                      >
                        Send
                      </Link>
                      <form action={snoozeFollowupAction}>
                        <input
                          name="followupId"
                          type="hidden"
                          value={item.followupId}
                        />
                        <input
                          name="targetId"
                          type="hidden"
                          value={item.targetId}
                        />
                        <input name="days" type="hidden" value="3" />
                        <button className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                          Snooze 3 days
                        </button>
                      </form>
                    </>
                  ) : (
                    <Link
                      className="inline-flex h-9 items-center gap-1 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel"
                      href={`/targets/${item.targetId}${item.kind === "stale" ? "#next-step" : ""}`}
                    >
                      {item.kind === "stale" ? "Set next step" : "Open"}
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  )}
                  {item.kind === "followup" && (
                    <form action={markDeadAction}>
                      <input
                        name="followupId"
                        type="hidden"
                        value={item.followupId}
                      />
                      <input
                        name="targetId"
                        type="hidden"
                        value={item.targetId}
                      />
                      <button className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                        Mark lost
                      </button>
                    </form>
                  )}
                </div>
              </article>
            ))}
            {work.length > shownWork.length && (
              <div className="px-4 py-3 text-sm text-muted">
                Showing the first {shownWork.length}. Use Pipeline and Follow-ups
                for the complete lists.
              </div>
            )}
          </div>
        ) : (
          <div className="px-4 py-10 text-center text-sm text-muted">
            You are caught up. Replies and scheduled next steps will appear here.
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-lg border border-line bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="font-semibold">Pipeline</h2>
              <p className="mt-1 text-xs text-muted">
                {pipeline.open} open · {pipeline.won} won · {pipeline.missingNextSteps}{" "}
                without a next step
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

        <section className="rounded-lg border border-line bg-white shadow-sm">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-semibold">Recently active</h2>
          </div>
          <div className="divide-y divide-line">
            {data.recentMessages.slice(0, 5).map((message) => (
              <div className="px-4 py-3 text-sm" key={message.id}>
                <div className="flex items-center justify-between gap-2">
                  <Link
                    className="font-medium hover:underline"
                    href={`/targets/${message.targetId}`}
                  >
                    {message.companyName}
                  </Link>
                  <StatusPill status={message.direction} />
                </div>
                <div className="mt-1 truncate text-muted">{message.subject}</div>
                <div className="mt-1 text-xs text-muted">
                  {timeAgo(message.sentAt ?? message.receivedAt)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <SendEmailModal
        closeHref="/dashboard"
        feedback={sendFeedback}
        target={sendTarget}
      />
    </>
  );
}

function buildWorkQueue(data: ReturnType<typeof getDashboardData>): WorkItem[] {
  const items = new Map<string, WorkItem>();

  for (const reply of data.replies) {
    if (items.has(reply.targetId)) continue;
    items.set(reply.targetId, {
      key: `reply-${reply.threadId}`,
      targetId: reply.targetId,
      companyName: reply.companyName,
      contactName: reply.contactName,
      contactEmail: reply.contactEmail,
      kind: "reply",
      title: reply.contactName
        ? `${reply.contactName} replied`
        : "A contact replied",
      detail: "Read the reply and decide the next step.",
      timing: timeAgo(reply.lastInboundAt),
      priority: 1
    });
  }

  for (const step of data.nextSteps) {
    if (items.has(step.targetId)) continue;
    items.set(step.targetId, {
      key: `step-${step.targetId}`,
      targetId: step.targetId,
      companyName: step.companyName,
      contactName: step.contactName,
      contactEmail: step.contactEmail,
      kind: "next_step",
      title: step.nextStep,
      detail: `Scheduled for ${formatDate(step.nextStepAt)}.`,
      timing: step.nextStepAt <= new Date().toISOString() ? "due now" : "upcoming",
      priority: 2
    });
  }

  for (const followup of data.followups) {
    if (items.has(followup.targetId)) continue;
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

    items.set(followup.targetId, {
      key: `followup-${followup.id}`,
      targetId: followup.targetId,
      companyName: followup.companyName,
      contactName: null,
      contactEmail: followup.contactEmail,
      kind: "followup",
      title: "Follow-up is due",
      detail: followup.lastOutboundAt
        ? `Last email sent ${timeAgo(followup.lastOutboundAt)}.`
        : "The contact form is ready for another step.",
      timing: formatDateTime(followup.dueAt),
      priority: 3,
      followupId: followup.id,
      canSend
    });
  }

  for (const stale of data.staleOpportunities) {
    if (items.has(stale.targetId)) continue;
    items.set(stale.targetId, {
      key: `stale-${stale.targetId}`,
      targetId: stale.targetId,
      companyName: stale.companyName,
      contactName: stale.contactName,
      contactEmail: stale.contactEmail,
      kind: "stale",
      title: "No next step",
      detail: `Last activity was ${timeAgo(stale.activityAt)}. Decide whether to continue or close it.`,
      timing: `stale for ${timeAgo(stale.activityAt).replace(" ago", "")}`,
      priority: 4
    });
  }

  return Array.from(items.values()).sort(
    (left, right) => left.priority - right.priority
  );
}

function workKindLabel(kind: WorkItem["kind"]) {
  return {
    reply: "Reply",
    next_step: "Next step",
    followup: "Follow-up",
    stale: "Needs decision"
  }[kind];
}

function workKindTone(kind: WorkItem["kind"]) {
  return {
    reply: "border-emerald-200 bg-emerald-50 text-emerald-800",
    next_step: "border-amber-200 bg-amber-50 text-amber-900",
    followup: "border-sky-200 bg-sky-50 text-sky-800",
    stale: "border-rose-200 bg-rose-50 text-rose-800"
  }[kind];
}
