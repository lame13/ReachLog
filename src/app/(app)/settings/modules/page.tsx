import { modules } from "@/modules";
import { sendTelegramTestAction } from "@/modules/settings/actions";

type PageProps = { searchParams?: Promise<{ telegramTest?: string; reason?: string }> };
const descriptions: Record<string, string> = {
  smtp: "Send individual emails from a connected mailbox.",
  imap: "Bring sent messages and replies into each contact’s history.",
  telegram: "Get notified about replies, due follow-ups and failed background tasks.",
  emaillistverify: "Check addresses before sending. Requires an EmailListVerify account.",
  demo: "Try sample data without sending emails or notifications.",
  contactForms: "Keep a record of outreach sent through website forms.",
  analytics: "Review outreach activity and replies by source."
};
const labels: Record<string, string> = { smtp: "Email sending", imap: "Mailbox sync", demo: "Demo mode" };

export default async function ModuleSettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const test = params?.telegramTest;
  const succeeded = test === "sent" || test === "demo";
  const testMessage = test === "sent" ? "Test notification sent."
    : test === "demo" ? "Demo: no notification was sent."
    : params?.reason === "telegram_disabled" ? "Connect Telegram before sending a test notification."
    : "Could not send the notification. Check the bot token, chat ID and server connection.";

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted">Check your connections and optional features.</p>
      </div>
      {test && (
        <div role="status" className={`mb-4 rounded-lg border px-4 py-3 text-sm ${succeeded ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
          {testMessage}
          {!succeeded && params?.reason && <details className="mt-2"><summary className="cursor-pointer">Technical details</summary><p className="mt-1 break-words font-mono text-xs">{params.reason}</p></details>}
        </div>
      )}
      <p className="mb-4 max-w-2xl text-sm text-muted">
        To connect an account, add its settings to your ReachLog configuration file and restart the app. Email and notifications are off until configured. The README explains each connection.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {modules.map((module) => (
          <section key={module.key} className="rounded-lg border border-line bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold">{labels[module.key] ?? module.label}</h2>
              <span className={`shrink-0 rounded-md px-2 py-1 text-xs ${module.enabled ? "bg-emerald-50 text-emerald-800" : "bg-gray-100 text-gray-600"}`}>{module.enabled ? "On" : "Off"}</span>
            </div>
            <p className="mt-2 text-sm text-muted">{descriptions[module.key]}</p>
            {module.envFlag && <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted">Configuration</summary><p className="mt-2 font-mono text-xs">{module.envFlag}</p><p className="mt-1 text-xs text-muted">Set to true after adding the required account details. Restart the app and scheduled tasks.</p></details>}
            {module.key === "telegram" && module.enabled && <form action={sendTelegramTestAction} className="mt-4"><button className="rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-panel">Send test notification</button></form>}
          </section>
        ))}
      </div>
    </>
  );
}
