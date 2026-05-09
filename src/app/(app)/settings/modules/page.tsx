import { modules } from "@/modules";

export default function ModuleSettingsPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Modules</h1>
        <p className="mt-1 text-sm text-muted">
          Runtime modules are controlled by environment variables on the server.
        </p>
      </div>

      <section className="rounded-lg border border-line bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[760px] text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Module</th>
                <th className="px-4 py-3 font-medium">Jobs</th>
                <th className="px-4 py-3 font-medium">Runtime flag</th>
                <th className="px-4 py-3 font-medium">State</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
