import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FileText, Mail, Target } from "lucide-react";
import { ExportLinks } from "@/components/export-links";
import { StagePill } from "@/components/stage-pill";
import { StatusPill } from "@/components/status-pill";
import { TimelineList } from "@/components/timeline-list";
import { formatDateTime, timeAgo } from "@/modules/core/dates";
import {
  addAccountNoteAction,
  updateAccountAction
} from "@/modules/accounts/actions";
import { getAccountDetail } from "@/modules/accounts/queries";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AccountDetailPage({ params }: PageProps) {
  const { id } = await params;
  const detail = getAccountDetail(id);

  if (!detail) {
    notFound();
  }

  const { account, contacts, targets, messages, timeline } = detail;
  const exportParams = { accountId: account.id };

  return (
    <>
      <div className="mb-6 rounded-lg border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{account.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
              <span>{account.domain ?? "unknown domain"}</span>
              {account.websiteUrl && (
                <a
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                  href={account.websiteUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  website
                </a>
              )}
              <span>
                {account.contactCount} contact{account.contactCount === 1 ? "" : "s"} ·{" "}
                {account.targetCount} target{account.targetCount === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportLinks entity="accounts" label="Accounts" params={exportParams} />
            <ExportLinks entity="contacts" label="Contacts" params={exportParams} />
            <ExportLinks entity="targets" label="Targets" params={exportParams} />
          </div>
        </div>
        {account.notes && (
          <p className="mt-4 whitespace-pre-wrap rounded-md bg-panel px-3 py-2 text-sm text-muted">
            {account.notes}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-semibold">Contacts</h2>
              <Link className="text-xs text-accent hover:underline" href="/contacts">
                All contacts
              </Link>
            </div>
            <div className="divide-y divide-line">
              {contacts.length ? (
                contacts.map((contact) => (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm" key={contact.id}>
                    <div>
                      <Link className="font-medium" href={`/contacts/${contact.id}`}>
                        {contact.name}
                      </Link>
                      <div className="text-muted">
                        {contact.email}
                        {contact.title ? ` · ${contact.title}` : ""}
                      </div>
                      {contact.tags && (
                        <div className="mt-1 text-xs text-muted">tags: {contact.tags}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill
                        status={contact.emailVerificationStatus ?? "not checked"}
                      />
                      <span className="text-xs text-muted">
                        {contact.targetCount} target
                        {contact.targetCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-muted">
                  No contact records on this account yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Target className="size-4 text-muted" aria-hidden="true" />
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
                      {target.contactEmail ?? "form only"} · updated{" "}
                      {timeAgo(target.updatedAt)} ({formatDateTime(target.updatedAt)})
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-muted">
                  No targets on this account yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Mail className="size-4 text-muted" aria-hidden="true" />
              <h2 className="font-semibold">Mail</h2>
            </div>
            <div className="divide-y divide-line">
              {messages.length ? (
                messages.map((message) => (
                  <div className="px-4 py-3 text-sm" key={message.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium capitalize">{message.direction}</span>
                      <span className="text-muted">{formatDateTime(message.at)}</span>
                    </div>
                    <div className="text-muted">{message.subject}</div>
                    <div className="mt-1 text-xs text-muted">
                      {message.fromEmail}
                      {message.companyName ? ` · ${message.companyName}` : ""}
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-muted">
                  No email on this account yet.
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Edit Account</h2>
            </div>
            <form action={updateAccountAction} className="space-y-3 p-4">
              <input name="accountId" type="hidden" value={account.id} />
              <Field label="Company" name="name" required value={account.name} />
              <Field label="Domain" name="domain" value={account.domain ?? ""} />
              <Field label="Website" name="websiteUrl" type="url" value={account.websiteUrl ?? ""} />
              <Area label="Notes" name="notes" value={account.notes ?? ""} />
              <button className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                Save account
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-sm">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold">Note</h2>
            </div>
            <form action={addAccountNoteAction} className="space-y-3 p-4">
              <input name="accountId" type="hidden" value={account.id} />
              <Area label="Note" name="note" value="" placeholder="What you learned about this company" />
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
