import { env } from "../core/env";

export async function sendTelegramMessage(text: string) {
  if (!env.TELEGRAM_ENABLED || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return { sent: false, reason: "telegram_disabled" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      return { sent: false, reason: `telegram_http_${response.status}` };
    }

    return { sent: true, reason: "sent" };
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "telegram_request_failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}
