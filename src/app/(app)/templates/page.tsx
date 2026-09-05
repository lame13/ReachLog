import Link from "next/link";
import { TemplateEditor } from "@/components/template-editor";
import { getTemplates } from "@/modules/templates/store";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams?: Promise<{ edit?: string }>;
}) {
  const params = await searchParams;
  const templates = getTemplates();
  const selected =
    templates.find((template) => template.id === params?.edit) ?? null;
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Email templates</h1>
        <p className="mt-1 text-sm text-muted">
          Save reusable introductions and follow-ups. Personalize and review
          each message before sending.
        </p>
      </div>
      {params?.edit && !selected && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900"
        >
          That template is no longer available. Create a new one or choose a
          saved template.
        </p>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
        <section className="min-w-0 rounded-lg border border-line bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">
            Saved templates{" "}
            <span className="text-sm font-normal text-muted">
              ({templates.length})
            </span>
          </h2>
          {templates.length ? (
            <ul className="space-y-2">
              {templates.map((template) => (
                <li key={template.id}>
                  <Link
                    href={`/templates?edit=${encodeURIComponent(template.id)}`}
                    aria-current={
                      selected?.id === template.id ? "page" : undefined
                    }
                    className={`block rounded-md border p-3 ${selected?.id === template.id ? "border-accent bg-panel" : "border-line hover:bg-panel"}`}
                  >
                    <span className="block break-words text-sm font-medium">
                      {template.name}
                    </span>
                    <span className="mt-1 block break-words text-xs text-muted">
                      {template.subject}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              No templates yet. Save a message you often reuse, then choose it
              when composing an email.
            </p>
          )}
        </section>
        <TemplateEditor key={selected?.id ?? "new"} template={selected} />
      </div>
    </>
  );
}
