import { ConnectionSettings } from "@/components/connection-settings";
import { BackgroundSettings } from "@/components/background-settings";
import { connectionGroups } from "@/modules/connections/fields";
import { getConnectionView } from "@/modules/connections/store";
import {
  getSchedules,
  scheduleBlocker,
  schedulerIsRunning,
} from "@/modules/scheduler/store";
import { env } from "@/modules/core/env";

export default function SettingsPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Connect your accounts and choose what runs in the background.
        </p>
      </div>
      <nav className="mb-5 flex gap-4 text-sm" aria-label="Settings sections">
        <a className="text-accent" href="#connections">
          Connections
        </a>
        <a className="text-accent" href="#background-tasks">
          Background tasks
        </a>
      </nav>
      <div className="space-y-6">
        <ConnectionSettings
          views={connectionGroups.map(getConnectionView)}
          demo={env.DEMO_MODE}
        />
        <BackgroundSettings
          schedules={getSchedules()}
          running={schedulerIsRunning()}
          blockers={{
            "mail-sync": scheduleBlocker("mail-sync"),
            "followup-check": scheduleBlocker("followup-check"),
            backup: scheduleBlocker("backup"),
          }}
          demo={env.DEMO_MODE}
        />
        <p className="text-xs text-muted">
          Connection passwords are stored in a private file in your data folder
          and are never returned to the browser. EmailListVerify, additional
          sender identities, and hosting authentication remain in your
          environment configuration.
        </p>
      </div>
    </>
  );
}
