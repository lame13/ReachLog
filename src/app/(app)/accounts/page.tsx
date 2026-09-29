import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { ExportLinks } from "@/components/export-links";
import { formatDateTime, timeAgo } from "@/modules/core/dates";
import { createAccountAction } from "@/modules/accounts/actions";
import { getAccounts } from "@/modules/accounts/queries";

type PageProps = {
  searchParams?: Promise<{
    q?: string;
    stage?: string;
    showCreate?: string;
  }>;
};

export default async function AccountsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const accounts = getAccounts({ q: params?.q, stage: params?.stage });
  const showCreate = params?.showCreate === "1";

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="mt-1 text-sm text-muted">
            The companies behind your outreach, with every contact and target in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportLinks entity="accounts" label="Accounts" params={{ q: params?.q, stage: params?.stage }} />
          <ExportLinks entity="contacts" label="Contacts" />
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white"
            href={showCreate ? "/accounts" : "/accounts?showCreate=1"}
          >
            <Plus className="size-4" aria-hidden="true" />
            {showCreate ? "Close form" : "New account"}
          </Link>
        </div>
      </div>

      {showCreate && (
        <section className="mb-4 rounded-lg border border-line bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h2 className="font-semibold">New Account</h2>
            <p className="mt-1 text-sm text-muted">
              Accounts are usually created for you when a target names a company.
              Add one here when you want the company on record first.
            </p>
          </div>
          <form action={createAccountAction} className="grid gap-3 lg:grid-cols-4">
            <Field label="Company" name="name" required />
            <Field label="Domain" name="domain" placeholder="acme.example" />
            <Field label="Website" name="websiteUrl" type="url" />
            <Field label="Notes" name="notes" />
            <div className="lg:col-span-4">
              <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white">
                <Plus className="size-4" aria-hidden="true" />
                Create account
              </button>
            </div>
          </form>
        </section>
      )}

      <form className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-4 shadow-sm lg:grid-cols-[1fr_200px_auto]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Search</span>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            />
            <input
              className="h-10 w-full rounded-md border border-line pl-9 pr-3 text-sm outline-none focus:border-accent"
              defaultValue={params?.q ?? ""}
              name="q"
              placeholder="Company, domain or note"
              type="search"
            />
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Pipeline</span>
          <select
            className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-accent"
            defaultValue={params?.stage ?? ""}
            name="stage"
          >
            <option value="">Any</option>
            <option value="open">Has open work</option>
            <option value="won">Has a won target</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="h-10 rounded-md bg-ink px-3 text-sm font-medium text-white">
            Apply
          </button>
          <Link
            className="inline-flex h-10 items-center rounded-md border border-line px-3 text-sm font-medium hover:bg-panel"
            href="/accounts"
          >
            Reset
          </Link>
        </div>
      </form>

      <section className="rounded-lg border border-line bg-white shadow-sm">
        <div className="border-b border-line px-4 py-3 text-sm text-muted">
          {accounts.length
            ? `${accounts.length} account${accounts.length === 1 ? "" : "s"}`
            : "No accounts match these filters"}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[760px] text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Domain</th>
                <th className="px-4 py-3 font-medium">Contacts</th>
                <th className="px-4 py-3 font-medium">Targets</th>
                <th className="px-4 py-3 font-medium">Open</th>
                <th className="px-4 py-3 font-medium">Won</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length ? (
                accounts.map((account) => (
                  <tr className="border-t border-line" key={account.id}>
                    <td className="px-4 py-3">
                      <Link className="font-medium" href={`/accounts/${account.id}`}>
                        {account.name}
                      </Link>
                      {account.notes && (
                        <div className="mt-1 max-w-72 truncate text-xs text-muted">
                          {account.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {account.domain ?? "unknown"}
                    </td>
                    <td className="px-4 py-3">{account.contactCount}</td>
                    <td className="px-4 py-3">{account.targetCount}</td>
                    <td className="px-4 py-3">{account.openTargetCount}</td>
                    <td className="px-4 py-3">{account.wonTargetCount}</td>
                    <td className="px-4 py-3 text-muted">
                      {account.lastActivityAt
                        ? `${timeAgo(account.lastActivityAt)} · ${formatDateTime(account.lastActivityAt)}`
                        : "no activity"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="border-t border-line">
                  <td className="px-4 py-10 text-center text-muted" colSpan={7}>
                    No accounts yet. Create a target and its company is added here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  placeholder
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input
        className="h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-accent"
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}
