import { getAnalyticsData } from "@/modules/outreach/queries";

export default function AnalyticsPage() {
  const data = getAnalyticsData();

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-muted">
          Event, status, and source counts from the outreach timeline.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
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
