"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Save } from "lucide-react";
import { saveDraftAction } from "@/modules/smtp/actions";
import {
  renderTemplate,
  unresolvedVariables,
  type EmailTemplate,
  type TemplateContext,
} from "@/modules/templates/render";
import { SendSubmitButton } from "./send-submit-button";

export function EmailComposerFields({
  initial,
  templates,
  context,
  canSend,
  children,
}: {
  initial: { subject: string; body: string };
  templates: EmailTemplate[];
  context: TemplateContext;
  canSend: boolean;
  children: ReactNode;
}) {
  const [message, setMessage] = useState(initial);
  const [previous, setPrevious] = useState<typeof initial | null>(null);
  const [selected, setSelected] = useState("");
  const { pending } = useFormStatus();
  const template = templates.find((item) => item.id === selected);
  const preview = template ? renderTemplate(template, context) : null;
  const missing = unresolvedVariables(message.subject + "\n" + message.body);
  return (
    <>
      <div className="rounded-md border border-line bg-panel p-3">
        <div className="block">
          <label
            htmlFor="composer-template"
            className="mb-1 block text-sm font-medium"
          >
            Email template
          </label>
          <select
            id="composer-template"
            className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">
              {templates.length
                ? "Choose a template to preview"
                : "No saved templates"}
            </option>
            {templates.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        {preview && (
          <div className="mt-3 text-sm">
            <p className="font-medium">Template preview</p>
            <p className="mt-2 break-words font-medium">{preview.subject}</p>
            <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-muted">
              {preview.body}
            </p>
            {preview.missing.length > 0 && (
              <p className="mt-2 text-amber-800">
                Missing contact details: {preview.missing.join(", ")}. Replace
                these variables in the message before sending.
              </p>
            )}
            <button
              type="button"
              className="mt-3 rounded-md border border-line bg-white px-3 py-2 font-medium"
              onClick={() => {
                setPrevious(message);
                setMessage({ subject: preview.subject, body: preview.body });
              }}
            >
              Use template
            </button>
            <p className="mt-1 text-xs text-muted">
              Replaces the subject and body below. You can edit the message
              before sending.
            </p>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-4 text-xs">
          <Link
            href="/templates"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent"
          >
            Manage templates (new tab)
          </Link>
          {previous && (
            <button
              type="button"
              className="text-accent"
              onClick={() => {
                setMessage(previous);
                setPrevious(null);
              }}
            >
              Undo template
            </button>
          )}
        </div>
      </div>
      <div className="block">
        <label
          htmlFor="composer-subject"
          className="mb-1 block text-sm font-medium"
        >
          Subject
        </label>
        <input
          id="composer-subject"
          className="h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-accent"
          name="subject"
          value={message.subject}
          maxLength={300}
          onChange={(event) =>
            setMessage({ ...message, subject: event.target.value })
          }
          required
        />
      </div>
      <div className="block">
        <label
          htmlFor="composer-body"
          className="mb-1 block text-sm font-medium"
        >
          Body
        </label>
        <textarea
          id="composer-body"
          className="min-h-48 w-full resize-y rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          name="body"
          value={message.body}
          maxLength={50000}
          onChange={(event) =>
            setMessage({ ...message, body: event.target.value })
          }
          required
        />
      </div>
      {missing.length > 0 && (
        <p
          role="status"
          className="rounded-md bg-amber-50 p-3 text-sm text-amber-900"
        >
          Replace these variables before sending: {missing.join(", ")}. You can
          still save this draft.
        </p>
      )}
      {children}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          formAction={saveDraftAction}
          disabled={pending}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium hover:bg-panel disabled:opacity-50"
          type="submit"
        >
          <Save className="size-4" aria-hidden="true" />
          Save draft
        </button>
        <SendSubmitButton disabled={!canSend || missing.length > 0} />
      </div>
    </>
  );
}
