import Link from "next/link";
import { Clock3, MailCheck, Send, Target } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { formatDateTime } from "@/modules/core/dates";
import { getAnalyticsData } from "@/modules/outreach/queries";

export default function AnalyticsPage() {
  const data = getAnalyticsData();
  const replyRate = percentage(data.metrics.repliedTargets, data.metrics.touchedTargets);
  const touchRate = percentage(data.metrics.touchedTargets, data.metrics.totalTargets);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-muted">
          Event, status, and source counts from the outreach timeline.
        </p>
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
