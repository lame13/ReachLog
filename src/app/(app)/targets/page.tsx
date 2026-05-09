import Link from "next/link";
import { AlertTriangle, Send } from "lucide-react";
import { SendEmailModal } from "@/components/send-email-modal";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime } from "@/modules/core/dates";
import { getSendTarget, getTargets } from "@/modules/outreach/queries";

type PageProps = {
  searchParams?: Promise<{
    sendTargetId?: string;
  }>;
};

export default async function TargetsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const targets = getTargets();
  const sendTarget = getSendTarget(params?.sendTargetId);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Targets</h1>
          <p className="mt-1 text-sm text-muted">
            Outreach records with email, source, status, and dedupe protection.
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {["status", "source", "domain", "has reply", "follow-up due", "do not resend"].map(
          (filter) => (
            <button
              key={filter}
              className="h-9 rounded-md border border-line bg-white px-3 text-sm font-medium text-muted hover:bg-panel hover:text-ink"
            >
              {filter}
            </button>
          )
        )}
      </div>

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
              {targets.map((target) => (
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
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SendEmailModal closeHref="/targets" target={sendTarget} />
    </>
  );
}
