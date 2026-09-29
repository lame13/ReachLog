"use server";

import { revalidatePath } from "next/cache";
import { forceRecheckContactEmail } from "@/modules/emailVerification/service";

export async function recheckContactEmailAction(formData: FormData) {
  const contactId = String(formData.get("contactId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");

  if (!contactId) {
    return;
  }

  await forceRecheckContactEmail({ contactId, targetId: targetId || null });

  revalidatePath("/dashboard");
  revalidatePath("/targets");
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/analytics");

  if (targetId) {
    revalidatePath(`/targets/${targetId}`);
  }
}
