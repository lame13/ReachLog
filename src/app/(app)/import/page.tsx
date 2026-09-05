import { ImportCsvPanel } from "@/components/import-csv-panel";

export default function ImportPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Import</h1>
        <p className="mt-1 text-sm text-muted">
          Review your contacts and check for duplicates before importing.
        </p>
      </div>

      <ImportCsvPanel />
    </>
  );
}
