import Link from "next/link";
import { MergeRecordsButton } from "@/components/merge-records-button";
import { formatDate } from "@/modules/core/dates";
import { getDuplicateSuggestions } from "@/modules/duplicates/queries";

export default function DuplicatesPage() {
  const suggestions = getDuplicateSuggestions();
  const total = suggestions.accounts.length + suggestions.contacts.length;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Possible duplicates</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          ReachLog suggests likely matches but never merges them automatically.
          Review both records, then keep the one with the better history and
          contact details. The older record is suggested first.
        </p>
      </div>

      {total === 0 ? (
        <section className="rounded-lg border border-line bg-white p-6 text-sm text-muted shadow-sm">
          No likely duplicates found. Accounts are compared by company name and
          contacts by name within a shared account or email domain.
        </section>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Accounts</h2>
              <p className="mt-1 text-xs text-muted">
                {suggestions.accounts.length} possible account match
                {suggestions.accounts.length === 1 ? "" : "es"}.
              </p>
            </div>
            <div className="divide-y divide-line">
              {suggestions.accounts.length ? (
                suggestions.accounts.map((suggestion) => (
                  <DuplicatePair
                    key={`${suggestion.keep.id}-${suggestion.merge.id}`}
                    kind="account"
                    records={[suggestion.keep, suggestion.merge].map((record) => ({
                      id: record.id,
                      name: record.name,
                      label: record.domain ? `${record.name} (${record.domain})` : record.name,
                      detail: `${record.domain ?? "no domain"} · ${record.contactCount} contacts · ${record.targetCount} targets`
                    }))}
                  />
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted">
                  No likely account duplicates.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Contacts</h2>
              <p className="mt-1 text-xs text-muted">
                {suggestions.contacts.length} possible contact match
                {suggestions.contacts.length === 1 ? "" : "es"}.
              </p>
            </div>
            <div className="divide-y divide-line">
              {suggestions.contacts.length ? (
                suggestions.contacts.map((suggestion) => (
                  <DuplicatePair
                    key={`${suggestion.keep.id}-${suggestion.merge.id}`}
                    kind="contact"
                    records={[suggestion.keep, suggestion.merge].map((record) => ({
                      id: record.id,
                      name: record.name,
                      label: record.email,
                      detail: `${record.email} · ${record.accountName ?? record.domain} · ${record.targetCount} targets · added ${formatDate(record.createdAt)}`
                    }))}
                  />
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted">
                  No likely contact duplicates.
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function DuplicatePair({ kind, records }: {
  kind: "account" | "contact";
  records: Array<{ id: string; name: string; label: string; detail: string }>;
}) {
  return (
    <article className="grid gap-4 px-4 py-4 lg:grid-cols-2">
      {records.map((record, index) => {
        const other = records[1 - index];
        return (
          <div className="min-w-0 space-y-2 rounded-md border border-line bg-panel p-3" key={record.id}>
            <Link className="font-medium hover:underline" href={`/${kind}s/${record.id}`}>
              {record.name}
            </Link>
            <div className="break-words text-xs text-muted">{record.detail}</div>
            <MergeRecordsButton
              kind={kind}
              keepId={record.id}
              keepName={record.label}
              mergeId={other.id}
              mergeName={other.label}
            />
          </div>
        );
      })}
    </article>
  );
}
