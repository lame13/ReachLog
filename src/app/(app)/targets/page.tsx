import Link from "next/link";
import { AlertTriangle, Plus, Search, Send } from "lucide-react";
import { ExportLinks } from "@/components/export-links";
import { SendEmailModal } from "@/components/send-email-modal";
import { StagePill } from "@/components/stage-pill";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime } from "@/modules/core/dates";
import { createTargetAction } from "@/modules/outreach/actions";
import {
  getSendTarget,
  getTargetFilterOptions,
  getTargets
} from "@/modules/outreach/queries";
import { isEmailVerificationBlocking } from "@/modules/emailVerification/service";
import { isTargetActionBlocked } from "@/modules/outreach/status";
import { pipelineStages } from "@/modules/pipeline/stages";
import { getSendFeedback } from "@/modules/smtp/feedback";

type PageProps = {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    stage?: string;
    source?: string;
    domain?: string;
    flag?: string;
    page?: string;
    sendTargetId?: string;
    sendStatus?: string;
    sendMessage?: string;
    showCreate?: string;
  }>;
};

const TARGETS_PER_PAGE = 50;

export default async function TargetsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const allTargets = getTargets({
    q: params?.q,
    status: params?.status,
    stage: params?.stage,
    source: params?.source,
    domain: params?.domain,
    flag: params?.flag
  });
  const totalTargets = allTargets.length;
  const totalPages = Math.max(1, Math.ceil(totalTargets / TARGETS_PER_PAGE));
  const currentPage = clampPage(params?.page, totalPages);
  const pageStart = (currentPage - 1) * TARGETS_PER_PAGE;
  const pageEnd = pageStart + TARGETS_PER_PAGE;
  const targets = allTargets.slice(pageStart, pageEnd);
  const filterOptions = getTargetFilterOptions();
  const sendTarget = getSendTarget(params?.sendTargetId);
  const sendFeedback = getSendFeedback(params);
  const showCreate = params?.showCreate === "1";
  const exportParams = {
    q: params?.q,
    status: params?.status,
    stage: params?.stage,
    source: params?.source,
    domain: params?.domain,
    flag: params?.flag
  };
  const listParams = {
    ...exportParams,
    page: currentPage > 1 ? String(currentPage) : undefined
  };
  const closeHref = targetsHref(listParams);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Targets</h1>
          <p className="mt-1 text-sm text-muted">
            Track who you contacted and what happens next.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportLinks entity="targets" label="Targets" params={exportParams} />
          <ExportLinks entity="contacts" label="Contacts" />
          <ExportLinks entity="messages" label="Mail" />
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white"
            href={showCreate ? "/targets" : "/targets?showCreate=1"}
          >
            <Plus className="size-4" aria-hidden="true" />
            {showCreate ? "Close form" : "New target"}
          </Link>
        </div>
      </div>

      {showCreate && <CreateTargetPanel />}

      <form className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
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
        <FilterSelect
          label="Stage"
          labels={Object.fromEntries(
            pipelineStages.map((stage) => [stage.key, stage.label])
          )}
          name="stage"
          options={pipelineStages.map((stage) => stage.key)}
          value={params?.stage}
        />
        <FilterSelect
          label="Status"
          name="status"
          options={filterOptions.statuses}
          value={params?.status}
        />
        <FilterSelect
          label="Source"
          name="source"
          options={filterOptions.sources}
          value={params?.source}
        />
        <FilterSelect
          label="Domain"
          name="domain"
          options={filterOptions.domains}
          value={params?.domain}
        />
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 text-sm">
          <div className="text-muted">
            {totalTargets ? (
              <>
                Showing {pageStart + 1}-{Math.min(pageEnd, totalTargets)} of{" "}
                {totalTargets}, sorted by latest activity
              </>
            ) : (
              "No matching targets"
            )}
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            params={exportParams}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[960px] text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Domain</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {targets.length ? (
                targets.map((target) => {
                  const sourceUrl = [target.sourceUrl, target.websiteUrl].find((value) => {
                    if (!value) return false;
                    try {
                      return ["http:", "https:"].includes(new URL(value).protocol);
                    } catch {
                      return false;
                    }
                  });
                  const canSend =
                    Boolean(target.contactEmail) &&
                    !isTargetActionBlocked(target) &&
                    !isEmailVerificationBlocking(target.emailVerificationStatus);

                  return (
                  <tr key={target.id} className="border-t border-line align-top">
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium"
                        href={`/targets/${target.id}`}
                        title={`Duplicate key: ${target.dedupeKey}`}
                      >
                        {target.companyName}
                      </Link>
                      <div className="mt-1 text-xs text-muted">
                        Activity {formatDateTime(target.activityAt)}
                      </div>
                      {target.accountId && target.accountName && (
                        <Link
                          className="mt-1 block text-xs text-accent hover:underline"
                          href={`/accounts/${target.accountId}`}
                        >
                          {target.accountName}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {target.contactEmail ?? "form only"}
                    </td>
                    <td className="px-4 py-3">{target.domain ?? "unknown"}</td>
                    <td className="px-4 py-3">
                      {sourceUrl ? (
                        <a
                          className="inline-block max-w-48 truncate text-accent hover:underline"
                          href={sourceUrl}
                          rel="noreferrer"
                          target="_blank"
                          title={sourceUrl}
                        >
                          {target.sourceType}
                        </a>
                      ) : (
                        target.sourceType
                      )}
                      {target.sourceType === "contact_form" && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                          <AlertTriangle className="size-3.5" />
                          protected by form record
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StagePill stage={target.stage} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={target.status} />
                    </td>
                    <td className="px-4 py-3">
                      {canSend ? (
                        <Link
                          className="inline-flex h-9 items-center gap-2 rounded-md bg-ink px-3 text-xs font-medium text-white"
                          href={targetsHref({ ...listParams, sendTargetId: target.id })}
                        >
                          <Send className="size-3.5" aria-hidden="true" />
                          Send
                        </Link>
                      ) : (
                        <span className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-200 px-3 text-xs font-medium text-muted">
                          <Send className="size-3.5" aria-hidden="true" />
                          Send
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })
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
        {totalTargets > TARGETS_PER_PAGE && (
          <div className="flex justify-end border-t border-line px-4 py-3">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              params={exportParams}
            />
          </div>
        )}
      </section>

      <SendEmailModal closeHref={closeHref} feedback={sendFeedback} target={sendTarget} />
    </>
  );
}

function Pagination({
  currentPage,
  totalPages,
  params
}: {
  currentPage: number;
  totalPages: number;
  params: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const previousPage = currentPage - 1;
  const nextPage = currentPage + 1;

  return (
    <nav className="inline-flex items-center gap-2" aria-label="Targets pagination">
      <PaginationLink
        disabled={currentPage <= 1}
        href={targetsHref({
          ...params,
          page: previousPage > 1 ? String(previousPage) : undefined
        })}
      >
        Previous
      </PaginationLink>
      <span className="text-xs text-muted">
        Page {currentPage} of {totalPages}
      </span>
      <PaginationLink
        disabled={currentPage >= totalPages}
        href={targetsHref({
          ...params,
          page: nextPage <= totalPages ? String(nextPage) : undefined
        })}
      >
        Next
      </PaginationLink>
    </nav>
  );
}

function PaginationLink({
  children,
  disabled,
  href
}: {
  children: React.ReactNode;
  disabled: boolean;
  href: string;
}) {
  if (disabled) {
    return (
      <span className="inline-flex h-9 items-center rounded-md border border-line px-3 text-xs font-medium text-muted opacity-50">
        {children}
      </span>
    );
  }

  return (
    <Link
      className="inline-flex h-9 items-center rounded-md border border-line px-3 text-xs font-medium hover:bg-panel"
      href={href}
    >
      {children}
    </Link>
  );
}

function targetsHref(params: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();

  return query ? `/targets?${query}` : "/targets";
}

function clampPage(value: string | undefined, totalPages: number) {
  const parsed = Number(value ?? 1);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(Math.max(1, Math.floor(parsed)), totalPages);
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
          <span className="mb-1 block text-xs font-medium text-muted">Stage</span>
          <select
            className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-accent"
            defaultValue="new"
            name="stage"
          >
            {pipelineStages.map((stage) => (
              <option key={stage.key} value={stage.key}>
                {stage.label}
              </option>
            ))}
          </select>
        </label>
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
  value,
  labels
}: {
  label: string;
  name: string;
  options: string[];
  value?: string;
  labels?: Record<string, string>;
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
            {labels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}
