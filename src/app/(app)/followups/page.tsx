import Link from "next/link";
import { Send } from "lucide-react";
import { SendEmailModal } from "@/components/send-email-modal";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime, timeAgo } from "@/modules/core/dates";
import { markDeadAction, snoozeFollowupAction } from "@/modules/followups/actions";
import { getFollowups, getSendTarget } from "@/modules/outreach/queries";

type PageProps = {
  searchParams?: Promise<{
    sendTargetId?: string;
  }>;
};

export default async function FollowupsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const followups = getFollowups("all");
  const sendTarget = getSendTarget(params?.sendTargetId);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Follow-ups</h1>
        <p className="mt-1 text-sm text-muted">
          Manual queue for due, overdue, upcoming, and snoozed outreach.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {["Due Today", "Overdue", "Upcoming", "Snoozed"].map((tab, index) => (
          <button
            key={tab}
            className={`h-9 rounded-md border px-3 text-sm font-medium ${
              index === 0
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-muted hover:bg-panel hover:text-ink"
            }`}
          >
            {tab}
          </button>
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
              {followups.map((followup) => (
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
                      <Link
                        className="inline-flex h-9 items-center gap-2 rounded-md bg-ink px-3 text-xs font-medium text-white"
                        href={`/followups?sendTargetId=${followup.targetId}`}
                      >
                        <Send className="size-3.5" aria-hidden="true" />
                        Send
                      </Link>
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
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SendEmailModal closeHref="/followups" target={sendTarget} />
    </>
  );
}
