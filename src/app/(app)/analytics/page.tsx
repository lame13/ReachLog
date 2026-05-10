import Link from "next/link";
import { Clock3, MailCheck, Send, Target } from "lucide-react";
import { ExportLinks } from "@/components/export-links";
import { MetricCard } from "@/components/metric-card";
import { formatDate, formatDateTime } from "@/modules/core/dates";
import {
  analyticsRangeOptions,
  getAnalyticsData,
  getAnalyticsRangeKey
} from "@/modules/outreach/queries";

type PageProps = {
  searchParams?: Promise<{
    range?: string;
  }>;
};

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeKey = getAnalyticsRangeKey(params?.range);
  const data = getAnalyticsData(rangeKey);
  const replyRate = percentage(data.metrics.repliedTargets, data.metrics.touchedTargets);
  const touchRate = percentage(data.metrics.touchedTargets, data.metrics.totalTargets);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="mt-1 text-sm text-muted">
            Event, status, and source counts from the outreach timeline.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportLinks entity="events" label="Events" />
          <ExportLinks entity="messages" label="Mail" />
          <ExportLinks entity="contact-forms" label="Forms" />
          <ExportLinks entity="outbound-sends" label="Sends" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Target}
          label="Targets"
          value={data.metrics.totalTargets}
        />
        <MetricCard
          icon={Send}
          label={`Touched (${touchRate})`}
          value={data.metrics.touchedTargets}
        />
        <MetricCard
          icon={MailCheck}
          label={`Replies (${replyRate})`}
          tone="green"
          value={data.metrics.repliedTargets}
        />
        <MetricCard
          icon={Clock3}
          label="Open follow-ups"
          tone="amber"
          value={data.metrics.openFollowups}
        />
      </div>

      <section className="mt-6 rounded-lg border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-semibold">Daily Activity</h2>
            <p className="mt-1 text-xs text-muted">
              {formatDate(data.dailyRange.start)} - {formatDate(data.dailyRange.end)}
            </p>
          </div>
          <RangeSelector selected={data.dailyRange.key} />
        </div>
        <DailyActivityChart rows={data.dailyActivity} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_420px]">
        <section className="rounded-lg border border-line bg-white shadow-sm">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-semibold">Source Performance</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[680px] text-sm">
              <thead className="bg-panel text-left text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Targets</th>
                  <th className="px-4 py-3 font-medium">Sent</th>
                  <th className="px-4 py-3 font-medium">Replies</th>
                  <th className="px-4 py-3 font-medium">Reply rate</th>
                  <th className="px-4 py-3 font-medium">Dead</th>
                </tr>
              </thead>
              <tbody>
                {data.sourcePerformance.map((row) => (
                  <tr key={row.sourceType} className="border-t border-line">
                    <td className="px-4 py-3 font-medium">{row.sourceType}</td>
                    <td className="px-4 py-3">{row.total}</td>
                    <td className="px-4 py-3">{row.sent}</td>
                    <td className="px-4 py-3">{row.replied}</td>
                    <td className="px-4 py-3">
                      {percentage(row.replied, row.sent)}
                    </td>
                    <td className="px-4 py-3">{row.dead}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white shadow-sm">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-semibold">Recent Events</h2>
          </div>
          <div className="divide-y divide-line">
            {data.recentEvents.map((event) => (
              <div key={event.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{event.eventType}</div>
                  <div className="text-xs text-muted">
                    {formatDateTime(event.createdAt)}
                  </div>
                </div>
                {event.targetId ? (
                  <Link className="mt-1 block text-muted" href={`/targets/${event.targetId}`}>
                    {event.companyName}
                  </Link>
                ) : (
                  <div className="mt-1 text-muted">mailbox</div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <CountPanel
          label="Events"
          rows={data.eventCounts.map((row) => ({
            label: row.eventType,
            count: row.count
          }))}
        />
        <CountPanel
          label="Sources"
          rows={data.sourceCounts.map((row) => ({
            label: row.sourceType,
            count: row.count
          }))}
        />
        <CountPanel
          label="Statuses"
          rows={data.statusCounts.map((row) => ({
            label: row.status,
            count: row.count
          }))}
        />
      </div>
    </>
  );
}

function RangeSelector({ selected }: { selected: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-panel p-1">
      {analyticsRangeOptions.map((option) => {
        const active = option.key === selected;

        return (
          <Link
            className={`inline-flex h-8 items-center rounded-md px-2 text-xs font-medium ${
              active ? "bg-white text-ink shadow-sm" : "text-muted hover:bg-white"
            }`}
            href={option.key === "7d" ? "/analytics" : `/analytics?range=${option.key}`}
            key={option.key}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}

function DailyActivityChart({
  rows
}: {
  rows: Array<{
    date: string;
    label: string;
    outreached: number;
    replied: number;
    bounced: number;
    followups: number;
    total: number;
  }>;
}) {
  const series = [
    { key: "outreached", label: "Outreached", className: "bg-sky-500" },
    { key: "replied", label: "Replies", className: "bg-emerald-500" },
    { key: "bounced", label: "Bounced", className: "bg-rose-500" },
    { key: "followups", label: "Follow-ups", className: "bg-amber-500" }
  ] as const;
  const max = Math.max(...rows.map((row) => row.total), 1);

  return (
    <div>
      <div className="flex flex-wrap gap-3 border-b border-line px-4 py-3 text-xs text-muted">
        {series.map((item) => (
          <div className="inline-flex items-center gap-2" key={item.key}>
            <span className={`size-2.5 rounded-sm ${item.className}`} />
            {item.label}
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-[760px] items-end gap-2 px-4 py-4">
          {rows.map((row) => {
            const height = row.total ? Math.max((row.total / max) * 100, 6) : 2;

            return (
              <div className="flex min-w-8 flex-1 flex-col items-center gap-2" key={row.date}>
                <div className="flex h-40 w-full max-w-10 items-end">
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-sm bg-panel"
                    style={{ height: `${height}%` }}
                    title={`${row.date}: ${row.outreached} outreached, ${row.replied} replies, ${row.bounced} bounced, ${row.followups} follow-ups`}
                  >
                    {series.map((item) => {
                      const value = row[item.key];

                      if (!value || !row.total) {
                        return null;
                      }

                      return (
                        <div
                          className={item.className}
                          key={item.key}
                          style={{ height: `${(value / row.total) * 100}%` }}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="w-14 text-center text-[11px] text-muted">{row.label}</div>
                <div className="text-xs font-medium">{row.total}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function percentage(value: number, total: number) {
  if (!total) {
    return "0%";
  }

  return `${Math.round((value / total) * 100)}%`;
}

function CountPanel({
  label,
  rows
}: {
  label: string;
  rows: Array<{ label: string; count: number }>;
}) {
  const max = Math.max(...rows.map((row) => row.count), 1);

  return (
    <section className="rounded-lg border border-line bg-white shadow-sm">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-semibold">{label}</h2>
      </div>
      <div className="space-y-4 p-4">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{row.label}</span>
              <span className="text-muted">{row.count}</span>
            </div>
            <div className="h-2 rounded-full bg-panel">
              <div
                className="h-2 rounded-full bg-accent"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
