import { Download } from "lucide-react";
import type { ExportEntity } from "@/modules/export/data";

export function ExportLinks({
  entity,
  label,
  params = {}
}: {
  entity: ExportEntity;
  label: string;
  params?: Record<string, string | undefined>;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-line bg-white p-1">
      <span className="inline-flex h-8 items-center gap-1 px-2 text-xs font-medium text-muted">
        <Download className="size-3.5" aria-hidden="true" />
        {label}
      </span>
      <a
        className="inline-flex h-8 items-center rounded-md px-2 text-xs font-medium hover:bg-panel"
        href={exportHref(entity, "csv", params)}
      >
        CSV
      </a>
      <a
        className="inline-flex h-8 items-center rounded-md px-2 text-xs font-medium hover:bg-panel"
        href={exportHref(entity, "json", params)}
      >
        JSON
      </a>
    </div>
  );
}

function exportHref(
  entity: ExportEntity,
  format: "csv" | "json",
  params: Record<string, string | undefined>
) {
  const searchParams = new URLSearchParams({ format });

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  return `/api/export/${entity}?${searchParams.toString()}`;
}
