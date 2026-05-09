import Link from "next/link";
import { AlertTriangle, Plus, Search, Send } from "lucide-react";
import { SendEmailModal } from "@/components/send-email-modal";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime } from "@/modules/core/dates";
import { createTargetAction } from "@/modules/outreach/actions";
import {
  getSendTarget,
  getTargetFilterOptions,
  getTargets
} from "@/modules/outreach/queries";

type PageProps = {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    source?: string;
    domain?: string;
    flag?: string;
    sendTargetId?: string;
    showCreate?: string;
  }>;
};

export default async function TargetsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const targets = getTargets({
    q: params?.q,
    status: params?.status,
    source: params?.source,
    domain: params?.domain,
    flag: params?.flag
  });
  const filterOptions = getTargetFilterOptions();
  const sendTarget = getSendTarget(params?.sendTargetId);
  const showCreate = params?.showCreate === "1";

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Targets</h1>
          <p className="mt-1 text-sm text-muted">
            Outreach records with email, source, status, and dedupe protection.
          </p>
        </div>
        <Link
          className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white"
          href={showCreate ? "/targets" : "/targets?showCreate=1"}
        >
          <Plus className="size-4" aria-hidden="true" />
          {showCreate ? "Close form" : "New target"}
        </Link>
      </div>

      {showCreate && <CreateTargetPanel />}

      <form className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-4 shadow-sm lg:grid-cols-[1fr_180px_180px_180px_160px_auto]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Search</span>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              className="h-10 w-full rounded-md border border-line pl-9 pr-3 text-sm outline-none focus:border-accent"
              defaultValue={params?.q ?? ""}
              name="q"
              placeholder="Company, email, domain"
              type="search"
            />
          </div>
        </label>
        <FilterSelect label="Status" name="status" options={filterOptions.statuses} value={params?.status} />
        <FilterSelect label="Source" name="source" options={filterOptions.sources} value={params?.source} />
        <FilterSelect label="Domain" name="domain" options={filterOptions.domains} value={params?.domain} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Flag</span>
          <select
            className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-accent"
            defaultValue={params?.flag ?? ""}
            name="flag"
          >
            <option value="">Any</option>
            <option value="do_not_resend">Do not resend</option>
            <option value="contact_form">Contact form</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="h-10 rounded-md bg-ink px-3 text-sm font-medium text-white">
            Apply
          </button>
          <Link
            className="inline-flex h-10 items-center rounded-md border border-line px-3 text-sm font-medium hover:bg-panel"
            href="/targets"
          >
            Reset
          </Link>
        </div>
      </form>

      <section className="rounded-lg border border-line bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[960px] text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Domain</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Dedupe</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {targets.length ? (
                targets.map((target) => (
                  <tr key={target.id} className="border-t border-line align-top">
                    <td className="px-4 py-3">
                      <Link className="font-medium" href={`/targets/${target.id}`}>
                        {target.companyName}
                      </Link>
                      <div className="mt-1 text-xs text-muted">
                        Updated {formatDateTime(target.updatedAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {target.contactEmail ?? "form only"}
                    </td>
                    <td className="px-4 py-3">{target.domain ?? "unknown"}</td>
                    <td className="px-4 py-3">{target.sourceType}</td>
                    <td className="px-4 py-3">
                      <div className="max-w-64 truncate font-mono text-xs text-muted">
                        {target.dedupeKey}
                      </div>
                      {target.sourceType === "contact_form" && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                          <AlertTriangle className="size-3.5" />
                          protected by form record
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={target.status} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        className="inline-flex h-9 items-center gap-2 rounded-md bg-ink px-3 text-xs font-medium text-white"
                        href={`/targets?sendTargetId=${target.id}`}
                      >
                        <Send className="size-3.5" aria-hidden="true" />
                        Send
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="border-t border-line">
                  <td className="px-4 py-10 text-center text-muted" colSpan={7}>
                    No targets match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <SendEmailModal closeHref="/targets" target={sendTarget} />
    </>
  );
}

function CreateTargetPanel() {
  return (
    <section className="mb-4 rounded-lg border border-line bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="font-semibold">New Target</h2>
        <p className="mt-1 text-sm text-muted">
          Creates the contact, target, dedupe key, and target_created event.
        </p>
      </div>
      <form action={createTargetAction} className="grid gap-3 lg:grid-cols-4">
        <TextField label="Company" name="companyName" required />
        <TextField label="Contact name" name="contactName" />
        <TextField label="Email" name="email" type="email" />
        <TextField label="Website" name="websiteUrl" type="url" />
        <TextField label="Source type" name="sourceType" defaultValue="manual" />
        <TextField label="Source URL" name="sourceUrl" type="url" />
        <TextField label="Dedupe key" name="dedupeKey" placeholder="auto if blank" />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Status</span>
          <select
            className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-accent"
            defaultValue="new"
            name="status"
          >
            {["new", "sent", "waiting", "replied", "follow-up due", "dead", "form submitted"].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end lg:col-span-4">
          <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white">
            <Plus className="size-4" aria-hidden="true" />
            Create target
          </button>
        </div>
      </form>
    </section>
  );
}

function TextField({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  placeholder
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input
        className="h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-accent"
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}

function FilterSelect({
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
