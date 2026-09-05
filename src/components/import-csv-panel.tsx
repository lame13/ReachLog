"use client";

import { useActionState } from "react";
import { AlertTriangle, CheckCircle2, DatabaseZap, Upload } from "lucide-react";
import {
  commitCsvImportAction,
  previewCsvImportAction
} from "@/modules/outreach/import-actions";
import {
  initialImportState,
  type ImportPreviewResult
} from "@/modules/outreach/import-state";

const resultStyles: Record<ImportPreviewResult, string> = {
  "new target": "border-emerald-200 bg-emerald-50 text-emerald-800",
  "repair existing target": "border-sky-200 bg-sky-50 text-sky-800",
  "duplicate target": "border-gray-200 bg-gray-50 text-gray-700",
  "duplicate contact": "border-gray-200 bg-gray-50 text-gray-700",
  "duplicate domain warning": "border-amber-200 bg-amber-50 text-amber-800",
  "duplicate in file": "border-gray-200 bg-gray-50 text-gray-700",
  invalid: "border-rose-200 bg-rose-50 text-rose-800"
};

export function ImportCsvPanel() {
  const [previewState, previewAction, previewPending] = useActionState(
    previewCsvImportAction,
    initialImportState
  );
  const [commitState, commitAction, commitPending] = useActionState(
    commitCsvImportAction,
    initialImportState
  );
  const activeState = commitState.message || commitState.error ? commitState : previewState;
  const canImport = previewState.summary.importable > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
        <div className="grid size-10 place-items-center rounded-md bg-panel">
          <Upload className="size-5 text-muted" aria-hidden="true" />
        </div>
        <h2 className="mt-4 font-semibold">Upload your contacts</h2>

        <form action={previewAction} className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">CSV file</span>
            <input
              className="block w-full text-sm text-muted file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-ink file:px-3 file:text-sm file:font-medium file:text-white"
              name="csvFile"
              type="file"
              accept=".csv,text/csv"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">CSV text</span>
            <textarea
              key={`${previewState.csvText.length}-${previewState.summary.total}`}
              className="min-h-56 w-full resize-y rounded-md border border-line px-3 py-2 font-mono text-xs outline-none focus:border-accent"
              name="csvText"
              defaultValue={previewState.csvText}
              placeholder="target,contact_type,contact_value,domain_key,dedupe_key,subject_or_form_context,message_text_or_summary,follow_up_date,next_action,do_not_resend"
            />
          </label>

          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
            disabled={previewPending}
            type="submit"
          >
            <DatabaseZap className="size-4" aria-hidden="true" />
            {previewPending ? "Checking..." : "Check for duplicates"}
          </button>
        </form>

        <div className="mt-5 rounded-md border border-line bg-panel p-3 text-sm text-muted">
          <div>Supported headers: target, contact_type, contact_value, domain_key, dedupe_key.</div>
          <div className="mt-1">
            Optional: follow_up_date, next_action, do_not_resend, source_reference.
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-semibold">Import preview</h2>
            <p className="mt-1 text-xs text-muted">
              {activeState.summary.total} rows, {activeState.summary.importable} importable,{" "}
              {activeState.summary.warnings} warnings
            </p>
          </div>

          <form action={commitAction}>
            <textarea
              className="hidden"
              name="csvText"
              readOnly
              value={previewState.csvText}
            />
            <button
              className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              disabled={!canImport || commitPending}
              type="submit"
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {commitPending
                ? "Importing..."
                : `Import ${previewState.summary.importable || 0}`}
            </button>
          </form>
        </div>

        {(activeState.error || activeState.message) && (
          <div
            className={`border-b border-line px-4 py-3 text-sm ${
              activeState.error ? "text-rose-700" : "text-emerald-700"
            }`}
          >
            {activeState.error ?? activeState.message}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-[960px] text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Row</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Domain</th>
                <th className="px-4 py-3 font-medium">Follow-up</th>
                <th className="px-4 py-3 font-medium">Dedupe</th>
                <th className="px-4 py-3 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {activeState.rows.length ? (
                activeState.rows.map((row) => (
                  <tr key={`${row.rowNumber}-${row.dedupeKey}`} className="border-t border-line align-top">
                    <td className="px-4 py-3 text-muted">{row.rowNumber}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.companyName}</div>
                      <div className="mt-1 text-xs text-muted">{row.sourceType}</div>
                    </td>
                    <td className="px-4 py-3 text-muted">{row.email || "none"}</td>
                    <td className="px-4 py-3">{row.domain || "unknown"}</td>
                    <td className="px-4 py-3 text-muted">
                      {row.followUpDate || "none"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="max-w-72 truncate font-mono text-xs text-muted">
                        {row.dedupeKey || "none"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs ${resultStyles[row.result]}`}
                      >
                        {(row.result.includes("duplicate") || row.result === "invalid") && (
                          <AlertTriangle className="size-3.5" aria-hidden="true" />
                        )}
                        {row.result}
                      </span>
                      <div className="mt-1 max-w-72 text-xs text-muted">
                        {row.reason}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="border-t border-line">
                  <td className="px-4 py-10 text-center text-muted" colSpan={7}>
                    Upload or paste CSV to preview duplicates.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
