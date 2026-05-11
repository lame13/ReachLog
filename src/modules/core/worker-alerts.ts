import { env } from "@/modules/core/env";
import { appUrl } from "@/modules/core/urls";
import { sendTelegramMessage } from "@/modules/telegram/notify";

export async function notifyWorkerFailure(workerName: string, error: unknown) {
  if (!env.TELEGRAM_ENABLED) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  await sendTelegramMessage(`${workerName} failed: ${message.slice(0, 800)}\n${appUrl("/dashboard")}`);
}
