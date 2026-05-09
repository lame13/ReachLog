"use server";

import { revalidatePath } from "next/cache";
import { getSqlite } from "@/modules/core/db/client";

export async function updateModuleSettingAction(formData: FormData) {
  const key = String(formData.get("key") ?? "");
  const enabled = formData.get("enabled") === "on" ? 1 : 0;

  if (!key) {
    return;
  }

  getSqlite()
    .prepare("UPDATE module_settings SET enabled = ?, updated_at = ? WHERE key = ?")
    .run(enabled, new Date().toISOString(), key);

  revalidatePath("/settings/modules");
}
