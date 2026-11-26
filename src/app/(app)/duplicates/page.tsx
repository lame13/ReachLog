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
          contacts by name within the same account.
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
                  <article
                    className="grid gap-4 px-4 py-4 lg:grid-cols-[1fr_auto_1fr_auto] lg:items-center"
                    key={`${suggestion.keep.id}-${suggestion.merge.id}`}
                  >
                    <RecordCard
                      name={suggestion.keep.name}
                      detail={`${suggestion.keep.domain ?? "no domain"} · ${suggestion.keep.contactCount} contacts · ${suggestion.keep.targetCount} targets`}
                      href={`/accounts/${suggestion.keep.id}`}
                      label="Keep"
                    />
                    <span className="hidden text-xs font-medium text-muted lg:block">
                      instead of
                    </span>
                    <RecordCard
                      name={suggestion.merge.name}
                      detail={`${suggestion.merge.domain ?? "no domain"} · ${suggestion.merge.contactCount} contacts · ${suggestion.merge.targetCount} targets`}
                      href={`/accounts/${suggestion.merge.id}`}
                      label="Merge"
                    />
                    <MergeRecordsButton
                      keepId={suggestion.keep.id}
                      keepName={suggestion.keep.name}
                      kind="account"
                      mergeId={suggestion.merge.id}
                      mergeName={suggestion.merge.name}
                    />
                  </article>
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
                  <article
                    className="grid gap-4 px-4 py-4 lg:grid-cols-[1fr_auto_1fr_auto] lg:items-center"
                    key={`${suggestion.keep.id}-${suggestion.merge.id}`}
                  >
                    <RecordCard
                      name={suggestion.keep.name}
                      detail={`${suggestion.keep.email} · ${suggestion.keep.accountName ?? suggestion.keep.domain} · ${suggestion.keep.targetCount} targets · added ${formatDate(suggestion.keep.createdAt)}`}
                      href={`/contacts/${suggestion.keep.id}`}
                      label="Keep"
                    />
                    <span className="hidden text-xs font-medium text-muted lg:block">
                      instead of
                    </span>
                    <RecordCard
                      name={suggestion.merge.name}
                      detail={`${suggestion.merge.email} · ${suggestion.merge.accountName ?? suggestion.merge.domain} · ${suggestion.merge.targetCount} targets · added ${formatDate(suggestion.merge.createdAt)}`}
                      href={`/contacts/${suggestion.merge.id}`}
                      label="Merge"
                    />
                    <MergeRecordsButton
                      keepId={suggestion.keep.id}
                      keepName={suggestion.keep.name}
                      kind="contact"
                      mergeId={suggestion.merge.id}
                      mergeName={suggestion.merge.email}
                    />
                  </article>
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

function RecordCard({
  name,
  detail,
  href,
  label
}: {
  name: string;
  detail: string;
  href: string;
  label: string;
}) {
  return (
    <div className="rounded-md border border-line bg-panel p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <Link className="mt-1 block font-medium hover:underline" href={href}>
        {name}
      </Link>
      <div className="mt-1 text-xs text-muted">{detail}</div>
    </div>
  );
}
