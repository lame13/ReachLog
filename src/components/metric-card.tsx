import type { LucideIcon } from "lucide-react";

export function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "default"
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: "default" | "amber" | "rose" | "green";
}) {
  const tones = {
    default: "bg-white text-ink",
    amber: "bg-amber-50 text-amber",
    rose: "bg-rose-50 text-rose",
    green: "bg-emerald-50 text-emerald-700"
  };

  return (
    <section className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted">{label}</div>
          <div className="mt-2 text-3xl font-semibold">{value}</div>
        </div>
        <div className={`grid size-10 place-items-center rounded-md ${tones[tone]}`}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
