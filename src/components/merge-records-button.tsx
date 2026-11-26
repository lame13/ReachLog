"use client";

import {
  mergeAccountsAction,
  mergeContactsAction
} from "@/modules/duplicates/actions";

export function MergeRecordsButton({
  kind,
  keepId,
  keepName,
  mergeId,
  mergeName
}: {
  kind: "account" | "contact";
  keepId: string;
  keepName: string;
  mergeId: string;
  mergeName: string;
}) {
  return (
    <form action={kind === "account" ? mergeAccountsAction : mergeContactsAction}>
      <input name="keepId" type="hidden" value={keepId} />
      <input name="mergeId" type="hidden" value={mergeId} />
      <button
        className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium"
        type="button"
        onClick={(event) => {
          if (window.confirm(`Merge “${mergeName}” into “${keepName}”? This removes “${mergeName}” and moves its history to the record you keep.`)) {
            event.currentTarget.form?.requestSubmit();
          }
        }}
      >
        Keep {keepName}
      </button>
    </form>
  );
}
