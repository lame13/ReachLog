import { modules } from "@/modules";
import { getModuleSettings } from "@/modules/outreach/queries";
import { updateModuleSettingAction } from "@/modules/settings/actions";

export default function ModuleSettingsPage() {
  const settings = getModuleSettings();
  const moduleMeta = new Map<string, (typeof modules)[number]>(
    modules.map((module) => [module.key, module])
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Modules</h1>
        <p className="mt-1 text-sm text-muted">
          Enable the parts of the outreach center that should run on this box.
        </p>
      </div>

      <section className="rounded-lg border border-line bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[760px] text-sm">
            <thead className="bg-panel text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Module</th>
                <th className="px-4 py-3 font-medium">Jobs</th>
                <th className="px-4 py-3 font-medium">Enabled</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {settings.map((setting) => {
                const meta = moduleMeta.get(setting.key);

                return (
                  <tr key={setting.key} className="border-t border-line">
                    <td className="px-4 py-3">
                      <div className="font-medium">{meta?.label ?? setting.key}</div>
                      <div className="text-xs text-muted">{setting.key}</div>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {meta?.jobs.length ? meta.jobs.join(", ") : "none"}
                    </td>
                    <td className="px-4 py-3">
                      <form
                        action={updateModuleSettingAction}
                        className="flex items-center gap-3"
                        id={`module-${setting.key}`}
                      >
                        <input name="key" type="hidden" value={setting.key} />
                        <input
                          className="size-4 accent-accent"
                          defaultChecked={setting.enabled}
                          name="enabled"
                          type="checkbox"
                        />
                      </form>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        className="h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-panel"
                        form={`module-${setting.key}`}
                        type="submit"
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
