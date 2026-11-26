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
    <form
      action={kind === "account" ? mergeAccountsAction : mergeContactsAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Merge “${mergeName}” into “${keepName}”? The other record will be removed after its activity is moved. This cannot be undone.`
        );
        if (!confirmed) event.preventDefault();
      }}
    >
      <input name="keepId" type="hidden" value={keepId} />
      <input name="mergeId" type="hidden" value={mergeId} />
      <button className="h-9 rounded-md bg-ink px-3 text-xs font-medium text-white">
        Merge into {keepName}
      </button>
    </form>
  );
}
