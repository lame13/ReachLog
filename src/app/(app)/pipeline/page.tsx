import Link from "next/link";
import { Search } from "lucide-react";
import { ExportLinks } from "@/components/export-links";
import { StageMoveForm } from "@/components/stage-move-form";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime, timeAgo } from "@/modules/core/dates";
import {
  getPipelineBoard,
  getPipelineSummary
} from "@/modules/pipeline/queries";

type PageProps = {
  searchParams?: Promise<{
    q?: string;
    stage?: string;
  }>;
};

export default async function PipelinePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const columns = getPipelineBoard({ q: params?.q });
  const summary = getPipelineSummary();
  const highlightedStage = params?.stage?.trim();
  const visibleColumns = highlightedStage
    ? columns.filter((column) => column.key === highlightedStage)
    : columns;
  const shown = visibleColumns.reduce((total, column) => total + column.count, 0);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Pipeline</h1>
          <p className="mt-1 text-sm text-muted">
            Every company you are working, by stage. Move a card to keep it honest.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportLinks entity="targets" label="Pipeline" params={{ q: params?.q, stage: params?.stage }} />
          <ExportLinks entity="accounts" label="Accounts" />
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <SummaryTile label="Open" value={summary.open} />
        <SummaryTile label="Won" tone="green" value={summary.won} />
        <SummaryTile label="Lost" value={summary.lost} />
        <SummaryTile label="Accounts" value={summary.accounts} />
        <SummaryTile
          label="Follow-ups due"
          tone={summary.overdueFollowups ? "amber" : "default"}
          value={summary.overdueFollowups}
        />
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-4 shadow-sm">
        <label className="block min-w-[240px] flex-1">
          <span className="mb-1 block text-xs font-medium text-muted">Search</span>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            />
            <input
              className="h-10 w-full rounded-md border border-line pl-9 pr-3 text-sm outline-none focus:border-accent"
              defaultValue={params?.q ?? ""}
              name="q"
              placeholder="Company, contact or email"
              type="search"
            />
          </div>
        </label>
        <label className="block min-w-[200px]">
          <span className="mb-1 block text-xs font-medium text-muted">Stage</span>
          <select
            className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-accent"
            defaultValue={params?.stage ?? ""}
            name="stage"
          >
            <option value="">All stages</option>
            {columns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="h-10 rounded-md bg-ink px-3 text-sm font-medium text-white">
            Apply
          </button>
          <Link
            className="inline-flex h-10 items-center rounded-md border border-line px-3 text-sm font-medium hover:bg-panel"
            href="/pipeline"
          >
            Reset
          </Link>
        </div>
      </form>

      {shown === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-white px-4 py-12 text-center text-sm text-muted">
          {params?.q
            ? "No companies match this search."
            : "No targets yet. Add one and it appears in New."}
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-full gap-4">
            {visibleColumns.map((column) => (
              <section
                className="flex w-[280px] shrink-0 flex-col rounded-lg border border-line bg-white shadow-sm"
                key={column.key}
              >
                <div className="border-b border-line px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">{column.label}</h2>
                    <span className="rounded-full bg-panel px-2 py-0.5 text-xs font-medium text-muted">
                      {column.count}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{column.description}</p>
                </div>
                <div className="flex-1 space-y-3 p-3">
                  {column.cards.length ? (
                    column.cards.map((card) => (
                      <article
                        className="rounded-md border border-line bg-white p-3 shadow-sm"
                        key={card.id}
                      >
                        <Link
                          className="block text-sm font-medium hover:underline"
                          href={`/targets/${card.id}`}
                        >
                          {card.companyName}
                        </Link>
                        {card.accountId &&
                          card.accountName &&
                          card.accountName !== card.companyName && (
                            <Link
                              className="mt-1 block text-xs text-accent hover:underline"
                              href={`/accounts/${card.accountId}`}
                            >
                              {card.accountName}
                            </Link>
                          )}
                        <div className="mt-1 text-xs text-muted">
                          {card.contactName ? `${card.contactName} · ` : ""}
                          {card.contactEmail ?? "form only"}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <StatusPill status={card.status} />
                          {card.doNotResend ? (
                            <StatusPill status="do not resend" />
                          ) : null}
                        </div>
                        <div className="mt-2 space-y-0.5 text-xs text-muted">
                          {card.nextFollowupAt && (
                            <div>Follow-up {formatDateTime(card.nextFollowupAt)}</div>
                          )}
                          <div>Active {timeAgo(card.activityAt)}</div>
                        </div>
                        <div className="mt-3">
                          <StageMoveForm stage={card.stage} targetId={card.id} />
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
                      Empty
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function SummaryTile({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: number;
  tone?: "default" | "green" | "amber";
}) {
  const tones = {
    default: "bg-white",
    green: "bg-emerald-50",
    amber: "bg-amber-50"
  };

  return (
    <div className={`rounded-lg border border-line p-4 shadow-sm ${tones[tone]}`}>
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
