import { modules } from "@/modules";
import { sendTelegramTestAction } from "@/modules/settings/actions";

type PageProps = {
  searchParams?: Promise<{
    telegramTest?: string;
    reason?: string;
  }>;
};

export default async function ModuleSettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const telegramTest = getTelegramTestMessage(params?.telegramTest, params?.reason);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Modules</h1>
        <p className="mt-1 text-sm text-muted">
          Runtime modules are controlled by environment variables on the server.
        </p>
      </div>

      {telegramTest && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            telegramTest.sent
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {telegramTest.message}
        </div>
      )}

      <section className="rounded-lg border border-line bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[760px] text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Module</th>
                <th className="px-4 py-3 font-medium">Jobs</th>
                <th className="px-4 py-3 font-medium">Runtime flag</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Test</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((module) => (
                <tr key={module.key} className="border-t border-line">
                  <td className="px-4 py-3">
                    <div className="font-medium">{module.label}</div>
                    <div className="text-xs text-muted">{module.key}</div>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {module.jobs.length ? module.jobs.join(", ") : "none"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {module.envFlag ?? "always on"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium ${
                        module.enabled
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-gray-200 bg-gray-50 text-gray-600"
                      }`}
                    >
                      {module.enabled ? "enabled" : "disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {module.key === "telegram" ? (
                      <form action={sendTelegramTestAction}>
                        <button className="inline-flex h-9 items-center rounded-md border border-line px-3 text-xs font-medium hover:bg-panel">
                          Send test
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-muted">none</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function getTelegramTestMessage(status: string | undefined, reason: string | undefined) {
  if (!status) {
    return null;
  }

  if (status === "sent") {
    return { sent: true, message: "Telegram test sent." };
  }

  return {
    sent: false,
    message: `Telegram test failed: ${reason || "unknown_error"}`
  };
}
