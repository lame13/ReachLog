"use client";

import { useRouter, useSearchParams } from "next/navigation";

type ActivitySeriesOption = {
  key: string;
  label: string;
  color: string;
};

export function ActivitySeriesFilter({
  options,
  selected
}: {
  options: ActivitySeriesOption[];
  selected: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedSet = new Set(selected);

  function update(nextKey: string, checked: boolean) {
    const next = new Set(selected);

    if (checked) {
      next.add(nextKey);
    } else {
      next.delete(nextKey);
    }

    const params = new URLSearchParams(searchParams.toString());
    const values = options
      .map((option) => option.key)
      .filter((key) => next.has(key));

    if (values.length === options.length) {
      params.delete("activity");
    } else if (values.length === 0) {
      params.set("activity", "none");
    } else {
      params.set("activity", values.join(","));
    }

    const query = params.toString();
    router.replace(query ? `/analytics?${query}` : "/analytics");
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 text-xs text-muted">
      {options.map((option) => (
        <label className="inline-flex cursor-pointer items-center gap-2" key={option.key}>
          <input
            checked={selectedSet.has(option.key)}
            className="size-3.5 accent-accent"
            onChange={(event) => update(option.key, event.target.checked)}
            type="checkbox"
          />
          <span
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: option.color }}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
