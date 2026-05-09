"use server";

import { revalidatePath } from "next/cache";
import { forceRecheckContactEmail } from "@/modules/emailVerification/service";

export async function recheckContactEmailAction(formData: FormData) {
  const contactId = String(formData.get("contactId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");

  if (!contactId || !targetId) {
    return;
  }

  await forceRecheckContactEmail({ contactId, targetId });

  revalidatePath("/dashboard");
  revalidatePath("/targets");
  revalidatePath(`/targets/${targetId}`);
  revalidatePath("/analytics");
}
