export const templateVariables = [
  "contact_name",
  "company",
  "email",
  "website",
] as const;
export type TemplateVariable = (typeof templateVariables)[number];
export type TemplateContext = Record<TemplateVariable, string | null>;
export type EmailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export function unresolvedVariables(text: string) {
  const variables = [...text.matchAll(/\{\{([^{}]*)\}\}/g)].map(
    (match) => match[1].trim() || "empty variable",
  );
  const remainder = text.replace(/\{\{[^{}]*\}\}/g, "");
  if (remainder.includes("{{") || remainder.includes("}}"))
    variables.push("incomplete variable");
  return [...new Set(variables)];
}

export function renderTemplate(
  template: Pick<EmailTemplate, "subject" | "body">,
  context: TemplateContext,
) {
  const render = (text: string) =>
    text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (original, key: string) => {
      if (!templateVariables.includes(key as TemplateVariable)) return original;
      return context[key as TemplateVariable]?.trim() || original;
    });
  const subject = render(template.subject).replace(/[\r\n]+/g, " ");
  const body = render(template.body);
  return { subject, body, missing: unresolvedVariables(subject + "\n" + body) };
}
