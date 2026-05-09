import Link from "next/link";
import { Send } from "lucide-react";
import { ExportLinks } from "@/components/export-links";
import { SendEmailModal } from "@/components/send-email-modal";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime, timeAgo } from "@/modules/core/dates";
import {
  completeFollowupAction,
  markDeadAction,
  snoozeFollowupAction
} from "@/modules/followups/actions";
import { getFollowups, getSendTarget } from "@/modules/outreach/queries";
import { isSendBlockedStatus } from "@/modules/outreach/status";

type PageProps = {
  searchParams?: Promise<{
    filter?: "due" | "overdue" | "upcoming" | "all";
    sendTargetId?: string;
  }>;
};

export default async function FollowupsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const activeFilter = params?.filter ?? "due";
  const followups = getFollowups(activeFilter);
  const sendTarget = getSendTarget(params?.sendTargetId);
  const tabs = [
    { label: "Due Today", filter: "due" },
    { label: "Overdue", filter: "overdue" },
    { label: "Upcoming", filter: "upcoming" },
    { label: "All Open", filter: "all" }
  ] as const;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Follow-ups</h1>
          <p className="mt-1 text-sm text-muted">
            Manual queue for due, overdue, upcoming, and snoozed outreach.
          </p>
        </div>
        <ExportLinks
          entity="followups"
          label="Follow-ups"
          params={{ filter: activeFilter }}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.filter}
            className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium ${
              activeFilter === tab.filter
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-muted hover:bg-panel hover:text-ink"
            }`}
            href={`/followups?filter=${tab.filter}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <section className="rounded-lg border border-line bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[900px] text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Due</th>
                <th className="px-4 py-3 font-medium">Last event</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {followups.length ? (
                followups.map((followup) => {
                  const canSend =
                    Boolean(followup.contactEmail) &&
                    !followup.doNotResend &&
                    !isSendBlockedStatus(followup.targetStatus);

                  return (
                  <tr key={followup.id} className="border-t border-line align-top">
                    <td className="px-4 py-3">
                      <Link className="font-medium" href={`/targets/${followup.targetId}`}>
                        {followup.companyName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {followup.contactEmail ?? "form only"}
                    </td>
                    <td className="px-4 py-3">{formatDateTime(followup.dueAt)}</td>
                    <td className="px-4 py-3 text-muted">
                      {followup.lastInboundAt
                        ? `reply ${timeAgo(followup.lastInboundAt)}`
                        : followup.lastOutboundAt
                          ? `email sent ${timeAgo(followup.lastOutboundAt)}`
                          : "form submitted"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={followup.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {canSend ? (
                          <Link
                            className="inline-flex h-9 items-center gap-2 rounded-md bg-ink px-3 text-xs font-medium text-white"
                            href={`/followups?filter=${activeFilter}&sendTargetId=${followup.targetId}`}
                          >
                            <Send className="size-3.5" aria-hidden="true" />
                            Send
                          </Link>
                        ) : (
                          <span className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-200 px-3 text-xs font-medium text-muted">
                            <Send className="size-3.5" aria-hidden="true" />
                            Send
                          </span>
                        )}
                        <form action={completeFollowupAction}>
                          <input name="followupId" type="hidden" value={followup.id} />
                          <input name="targetId" type="hidden" value={followup.targetId} />
                          <button className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                            Complete
                          </button>
                        </form>
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
                })
              ) : (
                <tr className="border-t border-line">
                  <td className="px-4 py-10 text-center text-muted" colSpan={6}>
                    No open follow-ups in this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <SendEmailModal closeHref="/followups" target={sendTarget} />
    </>
  );
}
