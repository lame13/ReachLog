import Link from "next/link";
import { Clock3, MailCheck, Send, Target } from "lucide-react";
import { ActivitySeriesFilter } from "@/components/activity-series-filter";
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
    activity?: string;
    range?: string;
  }>;
};

const dailyActivitySeries = [
  { key: "outreached", label: "New outreach", color: "#0ea5e9" },
  { key: "replied", label: "Replies", color: "#10b981" },
  { key: "bounced", label: "Bounced", color: "#f43f5e" },
  { key: "followups", label: "Follow-ups", color: "#f59e0b" }
] as const;

type DailyActivitySeriesKey = (typeof dailyActivitySeries)[number]["key"];

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rangeKey = getAnalyticsRangeKey(params?.range);
  const selectedActivitySeries = getDailyActivitySeriesKeys(params?.activity);
  const data = getAnalyticsData(rangeKey);
  const replyRate = percentage(data.metrics.repliedTargets, data.metrics.touchedTargets);
  const outreachRate = percentage(data.metrics.touchedTargets, data.metrics.totalTargets);

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
          label={`Outreached (${outreachRate})`}
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
          <RangeSelector
            activity={selectedActivitySeries}
            selected={data.dailyRange.key}
          />
        </div>
        <DailyActivityChart
          rows={data.dailyActivity}
          selectedSeries={selectedActivitySeries}
        />
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
                  <th className="px-4 py-3 font-medium">Outreached</th>
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

function RangeSelector({
  activity,
  selected
}: {
  activity: DailyActivitySeriesKey[];
  selected: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-panel p-1">
      {analyticsRangeOptions.map((option) => {
        const active = option.key === selected;

        return (
          <Link
            className={`inline-flex h-8 items-center rounded-md px-2 text-xs font-medium ${
              active ? "bg-white text-ink shadow-sm" : "text-muted hover:bg-white"
            }`}
            href={analyticsHref({
              activity,
              range: option.key === "7d" ? undefined : option.key
            })}
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
  rows,
  selectedSeries
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
  selectedSeries: DailyActivitySeriesKey[];
}) {
  const selectedSet = new Set(selectedSeries);
  const series = dailyActivitySeries.filter((item) => selectedSet.has(item.key));
  const rowsWithSelectedTotals = rows.map((row) => ({
    ...row,
    visibleTotal: series.reduce((total, item) => total + row[item.key], 0)
  }));
  const max = Math.max(...rowsWithSelectedTotals.map((row) => row.visibleTotal), 1);

  return (
    <div>
      <ActivitySeriesFilter
        options={[...dailyActivitySeries]}
        selected={selectedSeries}
      />
      <div className="overflow-x-auto">
        <div className="flex min-w-[760px] items-end gap-2 px-4 py-4">
          {rowsWithSelectedTotals.map((row) => {
            const height = row.visibleTotal ? Math.max((row.visibleTotal / max) * 100, 6) : 2;

            return (
              <div
                className="group relative flex min-w-8 flex-1 flex-col items-center gap-2"
                key={row.date}
              >
                <div className="pointer-events-none absolute bottom-16 left-1/2 z-20 hidden w-52 -translate-x-1/2 rounded-md border border-line bg-white p-3 text-left text-xs shadow-soft group-hover:block">
                  <div className="mb-2 font-semibold text-ink">{row.date}</div>
                  <div className="space-y-1">
                    {dailyActivitySeries.map((item) => (
                      <div className="flex items-center justify-between gap-3" key={item.key}>
                        <span className="inline-flex items-center gap-2 text-muted">
                          <span
                            className="size-2 rounded-sm"
                            style={{ backgroundColor: item.color }}
                          />
                          {item.label}
                        </span>
                        <span className="font-medium text-ink">{row[item.key]}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                    <span className="text-muted">Selected total</span>
                    <span className="font-semibold text-ink">{row.visibleTotal}</span>
                  </div>
                </div>
                <div className="flex h-40 w-full max-w-10 items-end">
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-sm bg-panel"
                    style={{ height: `${height}%` }}
                    title={`${row.date}: ${row.outreached} new outreach, ${row.replied} replies, ${row.bounced} bounced, ${row.followups} follow-ups`}
                  >
                    {series.map((item) => {
                      const value = row[item.key];

                      if (!value || !row.visibleTotal) {
                        return null;
                      }

                      return (
                        <div
                          key={item.key}
                          style={{
                            backgroundColor: item.color,
                            height: `${(value / row.visibleTotal) * 100}%`
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="w-14 text-center text-[11px] text-muted">{row.label}</div>
                <div className="text-xs font-medium">{row.visibleTotal}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getDailyActivitySeriesKeys(value: string | undefined) {
  const validKeys = new Set(dailyActivitySeries.map((item) => item.key));

  if (!value) {
    return dailyActivitySeries.map((item) => item.key);
  }

  if (value === "none") {
    return [];
  }

  const keys = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is DailyActivitySeriesKey => validKeys.has(item as DailyActivitySeriesKey));

  return keys.length ? keys : dailyActivitySeries.map((item) => item.key);
}

function analyticsHref({
  activity,
  range
}: {
  activity: DailyActivitySeriesKey[];
  range?: string;
}) {
  const params = new URLSearchParams();

  if (range) {
    params.set("range", range);
  }

  if (activity.length === 0) {
    params.set("activity", "none");
  } else if (activity.length !== dailyActivitySeries.length) {
    params.set("activity", activity.join(","));
  }

  const query = params.toString();

  return query ? `/analytics?${query}` : "/analytics";
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
