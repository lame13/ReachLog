"use server";

import { revalidatePath } from "next/cache";
import { deleteTemplate, saveTemplate, TemplateInputError } from "./store";

export async function templateAction(
  operation: "save" | "delete",
  form: FormData,
): Promise<{
  ok: boolean;
  message: string;
  id?: string;
  errors?: Record<string, string>;
}> {
  const id = String(form.get("id") ?? "");
  if (!["save", "delete"].includes(operation))
    return { ok: false, message: "Choose a template action." };
  try {
    if (operation === "delete") {
      if (!id) return { ok: false, message: "Choose a template to delete." };
      deleteTemplate(id);
      revalidatePath("/templates");
      return {
        ok: true,
        message: "Template deleted. Saved drafts are unchanged.",
      };
    }
    const templateId = saveTemplate(id || null, {
      name: String(form.get("name") ?? ""),
      subject: String(form.get("subject") ?? ""),
      body: String(form.get("body") ?? ""),
    });
    revalidatePath("/templates");
    return {
      ok: true,
      message: "Template saved. It is available in the email composer.",
      id: templateId,
    };
  } catch (error) {
    if (error instanceof TemplateInputError)
      return { ok: false, message: error.message, errors: error.fields };
    return {
      ok: false,
      message:
        "Could not update this template. Refresh the page and try again.",
    };
  }
}
