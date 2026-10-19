import Link from "next/link";
import { Check, ExternalLink, X } from "lucide-react";
import {
  acceptAiSuggestionAction,
  rejectAiSuggestionAction
} from "@/modules/ai/actions";
import { getPendingAiReviews } from "@/modules/ai/review";
import { formatDateTime } from "@/modules/core/dates";

const kindLabels = {
  reply_triage: "Reply triage",
  followup_draft: "Follow-up draft",
  unlinked_lead: "Unlinked lead"
} as const;

export default function ReviewPage() {
  const items = getPendingAiReviews();

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">AI review</h1>
        <p className="mt-1 text-sm text-muted">
          Suggestions that need a human decision. Accepting a reply assessment
          can move the stage, create the follow-up, and save the draft.
        </p>
      </div>

      {items.length === 0 ? (
        <section className="rounded-lg border border-line bg-white p-6 text-sm text-muted shadow-sm">
          Nothing waiting. New replies, follow-up drafts, and inbound leads will
          appear here when the AI worker has something worth reviewing.
        </section>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const draft =
              item.kind === "followup_draft"
                ? { subject: item.output.subject, body: item.output.body }
                : item.output.draft;

            return (
            <section
              key={item.run.id}
              className="rounded-lg border border-line bg-white shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-panel px-2 py-1 text-xs font-medium text-muted">
                      {kindLabels[item.kind]}
                    </span>
                    <span className="text-sm font-medium">
                      {item.kind === "unlinked_lead"
                        ? item.output.company || item.from || "Unknown sender"
                        : item.companyName || "Unknown company"}
                    </span>
                    <span className="text-xs text-muted">
                      {item.kind === "followup_draft"
                        ? "Draft ready"
                        : `${Math.round(item.output.confidence * 100)}% confidence`}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {formatDateTime(item.run.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.kind !== "unlinked_lead" && item.targetId && (
                    <Link
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel"
                      href={`/targets/${item.targetId}`}
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      Open target
                    </Link>
                  )}
                  <form action={acceptAiSuggestionAction}>
                    <input name="runId" type="hidden" value={item.run.id} />
                    <button className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-xs font-medium text-white">
                      <Check className="size-3.5" aria-hidden="true" />
                      {item.kind === "unlinked_lead" ? "Create lead" : "Accept"}
                    </button>
                  </form>
                  <form action={rejectAiSuggestionAction}>
                    <input name="runId" type="hidden" value={item.run.id} />
                    <button className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                      <X className="size-3.5" aria-hidden="true" />
                      Reject
                    </button>
                  </form>
                </div>
              </div>

              <div className="grid gap-4 p-4 text-sm lg:grid-cols-[1fr_1fr]">
                <div className="space-y-3">
                  {item.kind === "reply_triage" && (
                    <>
                      <p>
                        <span className="font-medium">Intent:</span>{" "}
                        {item.output.intent.replaceAll("_", " ")}
                        {item.output.suggestedStage && (
                          <>
                            {" "}
                            · <span className="font-medium">Stage:</span>{" "}
                            {item.output.suggestedStage.replaceAll("_", " ")}
                          </>
                        )}
                      </p>
                      <p className="text-muted">{item.output.summary}</p>
                      {item.output.evidence.length > 0 && (
                        <ul className="space-y-2 border-l-2 border-line pl-3 text-muted">
                          {item.output.evidence.map((quote) => (
                            <li key={quote}>“{quote}”</li>
                          ))}
                        </ul>
                      )}
                      {item.output.asks.length > 0 && (
                        <p>
                          <span className="font-medium">Asked for:</span>{" "}
                          {item.output.asks.join("; ")}
                        </p>
                      )}
                      <p className="text-muted">
                        Next: {item.output.nextAction.reason}
                      </p>
                    </>
                  )}
                  {item.kind === "followup_draft" && (
                    <>
                      <p>
                        <span className="font-medium">Due:</span>{" "}
                        {item.dueAt ? formatDateTime(item.dueAt) : "unknown"}
                      </p>
                      <p className="text-muted">{item.output.rationale}</p>
                    </>
                  )}
                  {item.kind === "unlinked_lead" && (
                    <>
                      <p>
                        <span className="font-medium">From:</span>{" "}
                        {item.from || item.output.email || "unknown"}
                      </p>
                      <p>
                        <span className="font-medium">Subject:</span>{" "}
                        {item.subject || "(none)"}
                      </p>
                      <p className="text-muted">{item.output.summary}</p>
                      {item.output.need && (
                        <p>
                          <span className="font-medium">Need:</span>{" "}
                          {item.output.need}
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div className="rounded-md border border-line bg-panel p-3">
                  {draft ? (
                    <>
                      <div className="text-xs font-medium text-muted">
                        {draft.subject}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                        {draft.body}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted">No reply draft.</p>
                  )}
                </div>
              </div>
            </section>
            );
          })}
        </div>
      )}
    </>
  );
}
