import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { ExportLinks } from "@/components/export-links";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime, timeAgo } from "@/modules/core/dates";
import { getAccountOptions } from "@/modules/accounts/queries";
import { createContactAction } from "@/modules/contacts/actions";
import { getContactFilterOptions, getContacts } from "@/modules/contacts/queries";

type PageProps = {
  searchParams?: Promise<{
    q?: string;
    domain?: string;
    tag?: string;
    accountId?: string;
    showCreate?: string;
  }>;
};

export default async function ContactsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const contacts = getContacts({
    q: params?.q,
    domain: params?.domain,
    tag: params?.tag,
    accountId: params?.accountId
  });
  const filterOptions = getContactFilterOptions();
  const accounts = getAccountOptions();
  const showCreate = params?.showCreate === "1";

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="mt-1 text-sm text-muted">
            The people you talk to, with the account they belong to and the outreach behind them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportLinks
            entity="contacts"
            label="Contacts"
            params={{ q: params?.q, domain: params?.domain, accountId: params?.accountId, tag: params?.tag }}
          />
          <ExportLinks entity="accounts" label="Accounts" />
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white"
            href={showCreate ? "/contacts" : "/contacts?showCreate=1"}
          >
            <Plus className="size-4" aria-hidden="true" />
            {showCreate ? "Close form" : "New contact"}
          </Link>
        </div>
      </div>

      {showCreate && (
        <section className="mb-4 rounded-lg border border-line bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h2 className="font-semibold">New Contact</h2>
            <p className="mt-1 text-sm text-muted">
              Email is required, because it is how a contact is matched to mail and to a target.
            </p>
          </div>
          <form action={createContactAction} className="grid gap-3 lg:grid-cols-4">
            <Field label="Name" name="name" />
            <Field label="Email" name="email" required type="email" />
            <Field label="Title" name="title" placeholder="Founder, CTO..." />
            <Field label="Phone" name="phone" />
            <Field label="Domain" name="domain" placeholder="auto from email" />
            <Field label="Tags" name="tags" placeholder="warm,referral" />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Account</span>
              <select
                className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-accent"
                defaultValue=""
                name="accountId"
              >
                <option value="">No account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Links" name="links" placeholder="One URL per line" />
            <div className="lg:col-span-4">
              <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white">
                <Plus className="size-4" aria-hidden="true" />
                Create contact
              </button>
            </div>
          </form>
        </section>
      )}

      <form className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-3">
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
              placeholder="Name, email, title or tag"
              type="search"
            />
          </div>
        </label>
        <Select label="Domain" name="domain" options={filterOptions.domains} value={params?.domain} />
        <Select label="Tag" name="tag" options={filterOptions.tags} value={params?.tag} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Account</span>
          <select
            className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-accent"
            defaultValue={params?.accountId ?? ""}
            name="accountId"
          >
            <option value="">Any</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="h-10 rounded-md bg-ink px-3 text-sm font-medium text-white">
            Apply
          </button>
          <Link
            className="inline-flex h-10 items-center rounded-md border border-line px-3 text-sm font-medium hover:bg-panel"
            href="/contacts"
          >
            Reset
          </Link>
        </div>
      </form>

      <section className="rounded-lg border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 text-sm text-muted">
          <div>
            {contacts.length
              ? `${contacts.length} contact${contacts.length === 1 ? "" : "s"}, sorted by name`
              : "No contacts match these filters"}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Tags</th>
                <th className="px-4 py-3 font-medium">Targets</th>
                <th className="px-4 py-3 font-medium">Email check</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length ? (
                contacts.map((contact) => (
                  <tr className="border-t border-line" key={contact.id}>
                    <td className="px-4 py-3">
                      <Link className="font-medium" href={`/contacts/${contact.id}`}>
                        {contact.name}
                      </Link>
                      {contact.notes && (
                        <div className="mt-1 max-w-64 truncate text-xs text-muted">
                          {contact.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{contact.email}</td>
                    <td className="px-4 py-3">
                      {contact.accountId ? (
                        <Link
                          className="text-accent hover:underline"
                          href={`/accounts/${contact.accountId}`}
                        >
                          {contact.accountName}
                        </Link>
                      ) : (
                        <span className="text-muted">unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{contact.title ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{contact.tags ?? "—"}</td>
                    <td className="px-4 py-3">{contact.targetCount}</td>
                    <td className="px-4 py-3">
                      <StatusPill
                        status={contact.emailVerificationStatus ?? "not checked"}
                      />
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {contact.lastActivityAt
                        ? `${timeAgo(contact.lastActivityAt)} · ${formatDateTime(contact.lastActivityAt)}`
                        : "no activity"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="border-t border-line">
                  <td className="px-4 py-10 text-center text-muted" colSpan={8}>
                    No contacts yet. Add one here or import a CSV with email addresses.
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

function Select({
  label,
  name,
  options,
  value
}: {
  label: string;
  name: string;
  options: string[];
  value?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <select
        className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-accent"
        defaultValue={value ?? ""}
        name={name}
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
