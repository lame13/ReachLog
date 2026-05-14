import Link from "next/link";
import type { ReactNode } from "react";
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
import { isEmailVerificationBlocking } from "@/modules/emailVerification/service";
import { getSendFeedback } from "@/modules/smtp/feedback";

type PageProps = {
  searchParams?: Promise<{
    filter?: "due" | "overdue" | "upcoming" | "all";
    page?: string;
    sendTargetId?: string;
    sendStatus?: string;
    sendMessage?: string;
  }>;
};

const FOLLOWUPS_PER_PAGE = 50;

export default async function FollowupsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const activeFilter = params?.filter ?? "due";
  const allFollowups = getFollowups(activeFilter);
  const totalFollowups = allFollowups.length;
  const totalPages = Math.max(1, Math.ceil(totalFollowups / FOLLOWUPS_PER_PAGE));
  const currentPage = clampPage(params?.page, totalPages);
  const pageStart = (currentPage - 1) * FOLLOWUPS_PER_PAGE;
  const pageEnd = pageStart + FOLLOWUPS_PER_PAGE;
  const followups = allFollowups.slice(pageStart, pageEnd);
  const sendTarget = getSendTarget(params?.sendTargetId);
  const sendFeedback = getSendFeedback(params);
  const listParams = {
    filter: activeFilter === "due" ? undefined : activeFilter,
    page: currentPage > 1 ? String(currentPage) : undefined
  };
  const closeHref = followupsHref(listParams);
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 text-sm">
          <div className="text-muted">
            {totalFollowups ? (
              <>
                Showing {pageStart + 1}-{Math.min(pageEnd, totalFollowups)} of{" "}
                {totalFollowups} follow-ups
              </>
            ) : (
              "No follow-ups in this view"
            )}
          </div>
          <Pagination
            currentPage={currentPage}
            params={{ filter: activeFilter === "due" ? undefined : activeFilter }}
            totalPages={totalPages}
          />
        </div>
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
                    !isSendBlockedStatus(followup.targetStatus) &&
                    !isEmailVerificationBlocking(followup.emailVerificationStatus);

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
                            href={followupsHref({
                              ...listParams,
                              sendTargetId: followup.targetId
                            })}
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
        {totalFollowups > FOLLOWUPS_PER_PAGE && (
          <div className="flex justify-end border-t border-line px-4 py-3">
            <Pagination
              currentPage={currentPage}
              params={{ filter: activeFilter === "due" ? undefined : activeFilter }}
              totalPages={totalPages}
            />
          </div>
        )}
      </section>

      <SendEmailModal closeHref={closeHref} feedback={sendFeedback} target={sendTarget} />
    </>
  );
}

function Pagination({
  currentPage,
  params,
  totalPages
}: {
  currentPage: number;
  params: Record<string, string | undefined>;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const previousPage = currentPage - 1;
  const nextPage = currentPage + 1;

  return (
    <nav className="inline-flex items-center gap-2" aria-label="Follow-ups pagination">
      <PaginationLink
        disabled={currentPage <= 1}
        href={followupsHref({
          ...params,
          page: previousPage > 1 ? String(previousPage) : undefined
        })}
      >
        Previous
      </PaginationLink>
      <span className="text-xs text-muted">
        Page {currentPage} of {totalPages}
      </span>
      <PaginationLink
        disabled={currentPage >= totalPages}
        href={followupsHref({
          ...params,
          page: nextPage <= totalPages ? String(nextPage) : undefined
        })}
      >
        Next
      </PaginationLink>
    </nav>
  );
}

function PaginationLink({
  children,
  disabled,
  href
}: {
  children: ReactNode;
  disabled: boolean;
  href: string;
}) {
  if (disabled) {
    return (
      <span className="inline-flex h-9 items-center rounded-md border border-line px-3 text-xs font-medium text-muted opacity-50">
        {children}
      </span>
    );
  }

  return (
    <Link
      className="inline-flex h-9 items-center rounded-md border border-line px-3 text-xs font-medium hover:bg-panel"
      href={href}
    >
      {children}
    </Link>
  );
}

function followupsHref(params: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();

  return query ? `/followups?${query}` : "/followups";
}

function clampPage(value: string | undefined, totalPages: number) {
  const parsed = Number(value ?? 1);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(Math.max(1, Math.floor(parsed)), totalPages);
}
