"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSqlite } from "@/modules/core/db/client";
import { appUrl } from "@/modules/core/urls";
import { sendTelegramMessage } from "@/modules/telegram/notify";

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

export async function sendTelegramTestAction() {
  if (process.env.DEMO_MODE === "true") {
    const params = new URLSearchParams({
      telegramTest: "demo",
      reason: "demo_mode"
    });

    redirect(`/settings/modules?${params.toString()}`);
  }

  const result = await sendTelegramMessage(
    `ReachLog Telegram test\n${new Date().toISOString()}\n${appUrl("/dashboard")}`
  );
  const params = new URLSearchParams({
    telegramTest: result.sent ? "sent" : "failed",
    reason: result.reason
  });

  redirect(`/settings/modules?${params.toString()}`);
}
