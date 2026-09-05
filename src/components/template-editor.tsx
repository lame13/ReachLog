"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { templateAction } from "@/modules/templates/actions";
import {
  renderTemplate,
  templateVariables,
  type EmailTemplate,
} from "@/modules/templates/render";

export function TemplateEditor({
  template,
}: {
  template: EmailTemplate | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    name: template?.name ?? "",
    subject: template?.subject ?? "",
    body: template?.body ?? "",
  });
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof templateAction>
  > | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pending, startTransition] = useTransition();
  const preview = renderTemplate(values, {
    contact_name: "Alex",
    company: "Example Company",
    email: "alex@example.test",
    website: "https://example.test",
  });
  const inputClass =
    "w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent";
  function submit(operation: "save" | "delete", form: FormData) {
    startTransition(async () => {
      const response = await templateAction(operation, form);
      setResult(response);
      if (response.ok) {
        router.replace(
          response.id
            ? `/templates?edit=${encodeURIComponent(response.id)}`
            : "/templates",
        );
        router.refresh();
      }
    });
  }
  return (
    <section className="min-w-0 rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold">
          {template ? "Edit template" : "New template"}
        </h2>
        {template && (
          <Link href="/templates" className="text-sm text-accent">
            New template
          </Link>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit("save", new FormData(event.currentTarget));
        }}
        className="space-y-4"
      >
        <input type="hidden" name="id" value={template?.id ?? ""} />
        {result && (
          <p
            role={result.ok ? "status" : "alert"}
            className={`rounded-md p-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}
          >
            {result.message}
          </p>
        )}
        {(["name", "subject", "body"] as const).map((field) => (
          <div key={field} className="block">
            <label
              htmlFor={`template-${field}`}
              className="mb-1 block text-sm font-medium"
            >
              {field === "name"
                ? "Template name"
                : field === "subject"
                  ? "Subject"
                  : "Body"}
            </label>
            {field === "body" ? (
              <textarea
                id={`template-${field}`}
                className={`${inputClass} min-h-48`}
                name={field}
                required
                maxLength={50000}
                value={values[field]}
                onChange={(event) =>
                  setValues({ ...values, [field]: event.target.value })
                }
                aria-invalid={Boolean(result?.errors?.[field])}
                aria-describedby={
                  result?.errors?.[field]
                    ? `template-${field}-error`
                    : undefined
                }
              />
            ) : (
              <input
                id={`template-${field}`}
                className={inputClass}
                name={field}
                required
                maxLength={field === "name" ? 100 : 300}
                value={values[field]}
                onChange={(event) =>
                  setValues({ ...values, [field]: event.target.value })
                }
                aria-invalid={Boolean(result?.errors?.[field])}
                aria-describedby={
                  result?.errors?.[field]
                    ? `template-${field}-error`
                    : undefined
                }
              />
            )}
            {result?.errors?.[field] && (
              <span
                id={`template-${field}-error`}
                className="mt-1 block text-sm text-rose-700"
              >
                {result.errors[field]}
              </span>
            )}
          </div>
        ))}
        <p className="text-sm text-muted">
          Available variables:{" "}
          {templateVariables.map((key) => (
            <code key={key} className="mr-2 inline-block">{`{{${key}}}`}</code>
          ))}
        </p>
        <details className="rounded-md border border-line p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Preview with sample contact
          </summary>
          <p className="mt-3 text-xs text-muted">
            Example Company · Alex · alex@example.test
          </p>
          <p className="mt-2 break-words font-medium">
            {preview.subject || "Subject preview"}
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-muted">
            {preview.body || "Your message preview will appear here."}
          </p>
          {preview.missing.length > 0 && (
            <p className="mt-2 text-amber-800">
              Unresolved variables: {preview.missing.join(", ")}
            </p>
          )}
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={pending}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save template"}
          </button>
          {template && (
            <button
              type="button"
              disabled={pending}
              className="rounded-md border border-line px-3 py-2 text-sm text-rose-700"
              onClick={() => setDeleting(true)}
            >
              Delete
            </button>
          )}
        </div>
        {deleting && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm">
            <p>Delete “{template?.name}”? Saved drafts will stay.</p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                disabled={pending}
                className="rounded-md bg-rose-700 px-3 py-2 text-white"
                onClick={() => {
                  const form = new FormData();
                  form.set("id", template?.id ?? "");
                  submit("delete", form);
                }}
              >
                Delete template
              </button>
              <button type="button" onClick={() => setDeleting(false)}>
                Keep template
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
