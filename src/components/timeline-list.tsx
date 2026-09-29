import Link from "next/link";
import { formatDateTime } from "@/modules/core/dates";
import type { TimelineItem } from "@/modules/timeline/events";

export function TimelineList({
  items,
  emptyLabel = "No activity yet."
}: {
  items: TimelineItem[];
  emptyLabel?: string;
}) {
  if (!items.length) {
    return <div className="px-4 py-3 text-sm text-muted">{emptyLabel}</div>;
  }

  return (
    <div className="divide-y divide-line">
      {items.map((item) => (
        <div className="px-4 py-3 text-sm" key={item.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-medium">{item.label}</div>
            <div className="text-xs text-muted">{formatDateTime(item.createdAt)}</div>
          </div>
          {item.detail && (
            <div className="mt-1 whitespace-pre-wrap text-muted">{item.detail}</div>
          )}
          {item.href && (
            <Link className="mt-1 block text-xs text-accent hover:underline" href={item.href}>
              {item.entityType}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
