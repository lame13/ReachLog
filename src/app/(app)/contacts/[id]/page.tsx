import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FileText, RefreshCw } from "lucide-react";
import { ExportLinks } from "@/components/export-links";
import { StagePill } from "@/components/stage-pill";
import { StatusPill } from "@/components/status-pill";
import { TimelineList } from "@/components/timeline-list";
import { formatDateTime, timeAgo } from "@/modules/core/dates";
import { getAccountOptions } from "@/modules/accounts/queries";
import {
  addContactNoteAction,
  updateContactAction
} from "@/modules/contacts/actions";
import {
  getContactDetail,
  parseStoredLinks
} from "@/modules/contacts/queries";
import { recheckContactEmailAction } from "@/modules/emailVerification/actions";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ContactDetailPage({ params }: PageProps) {
  const { id } = await params;
  const detail = getContactDetail(id);

  if (!detail) {
    notFound();
  }

  const { contact, targets, forms, timeline } = detail;
  const accounts = getAccountOptions();
  const links = parseStoredLinks(contact.linksJson);

  return (
    <>
      <div className="mb-6 rounded-lg border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{contact.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
              <a className="text-accent hover:underline" href={`mailto:${contact.email}`}>
                {contact.email}
              </a>
              {contact.title && <span>{contact.title}</span>}
              {contact.phone && <span>{contact.phone}</span>}
              <span>{contact.domain}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusPill status={contact.emailVerificationStatus ?? "not checked"} />
              {contact.accountId ? (
                <Link
                  className="inline-flex h-7 items-center rounded-full border border-line px-2.5 text-xs font-medium text-accent hover:bg-panel"
                  href={`/accounts/${contact.accountId}`}
                >
                  {contact.accountName}
                </Link>
              ) : (
                <span className="inline-flex h-7 items-center rounded-full border border-line px-2.5 text-xs font-medium text-muted">
                  no account
                </span>
              )}
              {contact.tags && (
                <span className="text-xs text-muted">tags: {contact.tags}</span>
              )}
            </div>
            {links.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                {links.map((link) => (
                  <a
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                    href={link}
                    key={link}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    {link}
                  </a>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportLinks entity="contacts" label="Contact" params={{ contactId: contact.id }} />
            <ExportLinks entity="messages" label="Mail" params={{ contactId: contact.id }} />
          </div>
        </div>
        {contact.notes && (
          <p className="mt-4 whitespace-pre-wrap rounded-md bg-panel px-3 py-2 text-sm text-muted">
            {contact.notes}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Targets</h2>
            </div>
            <div className="divide-y divide-line">
              {targets.length ? (
                targets.map((target) => (
                  <div className="px-4 py-3 text-sm" key={target.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link className="font-medium" href={`/targets/${target.id}`}>
                        {target.companyName}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2">
                        <StagePill stage={target.stage} />
                        <StatusPill status={target.status} />
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      source: {target.sourceType} · updated {timeAgo(target.updatedAt)} (
                      {formatDateTime(target.updatedAt)})
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-muted">
                  This contact has no target yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Contact Forms</h2>
            </div>
            <div className="divide-y divide-line">
              {forms.length ? (
                forms.map((form) => (
                  <div className="px-4 py-3 text-sm" key={form.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{form.formUrl}</span>
                      <span className="text-muted">{formatDateTime(form.submittedAt)}</span>
                    </div>
                    <p className="mt-1 text-muted">{form.messageText}</p>
                  </div>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-muted">No form submissions.</div>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Email Verification</h2>
            </div>
            <div className="space-y-3 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={contact.emailVerificationStatus ?? "not checked"} />
                <span className="text-muted">
                  {contact.emailVerificationProvider ?? "emaillistverify"}
                </span>
              </div>
              <form action={recheckContactEmailAction}>
                <input name="contactId" type="hidden" value={contact.id} />
                <input name="targetId" type="hidden" value={targets[0]?.id ?? ""} />
                <button className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  Recheck email
                </button>
              </form>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Edit Contact</h2>
            </div>
            <form action={updateContactAction} className="space-y-3 p-4">
              <input name="contactId" type="hidden" value={contact.id} />
              <Field label="Name" name="name" value={contact.name} />
              <Field label="Email" name="email" required type="email" value={contact.email} />
              <Field label="Title" name="title" value={contact.title ?? ""} />
              <Field label="Phone" name="phone" value={contact.phone ?? ""} />
              <Field label="Domain" name="domain" value={contact.domain} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Account</span>
                <select
                  className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-accent"
                  defaultValue={contact.accountId ?? ""}
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
              <Field label="Tags" name="tags" value={contact.tags ?? ""} />
              <Area
                label="Links"
                name="links"
                placeholder="One URL per line"
                value={links.join("\n")}
              />
              <Area label="Notes" name="notes" value={contact.notes ?? ""} />
              <button className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                Save contact
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Note</h2>
            </div>
            <form action={addContactNoteAction} className="space-y-3 p-4">
              <input name="contactId" type="hidden" value={contact.id} />
              <Area label="Note" name="note" placeholder="Add a private note" value="" />
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                <FileText className="size-3.5" aria-hidden="true" />
                Save note
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Timeline</h2>
            </div>
            <TimelineList items={timeline} />
          </section>
        </aside>
      </div>
    </>
  );
}

function Field({
  label,
  name,
  value,
  type = "text",
  required = false
}: {
  label: string;
  name: string;
  value: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input
        className="h-9 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-accent"
        defaultValue={value}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}

function Area({
  label,
  name,
  value,
  placeholder
}: {
  label: string;
  name: string;
  value: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <textarea
        className="min-h-24 w-full resize-y rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
        defaultValue={value}
        name={name}
        placeholder={placeholder}
      />
    </label>
  );
}
