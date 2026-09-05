"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  scheduleDefinitions,
  type Schedule,
  type ScheduleName,
} from "@/modules/scheduler/definitions";
import { scheduleAction } from "@/modules/scheduler/actions";

export function BackgroundSettings({
  schedules,
  running,
  blockers,
  demo,
}: {
  schedules: Schedule[];
  running: boolean;
  blockers: Record<ScheduleName, string | null>;
  demo: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <section
      id="background-tasks"
      className="scroll-mt-28 rounded-lg border border-line bg-white shadow-sm"
    >
      <div className="border-b border-line p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Background tasks</h2>
          <span
            className={`rounded-md px-2 py-1 text-xs font-medium ${running ? "bg-emerald-50 text-emerald-800" : "bg-panel text-muted"}`}
          >
            {demo
              ? "Off in demo mode"
              : running
                ? "Scheduler running"
                : "Scheduler stopped"}
          </span>
        </div>
        <p className="mt-2 text-sm text-muted">
          Choose which tasks run automatically while ReachLog is running.
          Pausing a schedule stops future runs; a task already running can
          finish.
        </p>
        {!running && !demo && (
          <p className="mt-2 text-sm text-amber-800">
            Start ReachLog with background scheduling enabled to run tasks here.
            External cron or systemd workers can still run separately.
          </p>
        )}
      </div>
      <div className="divide-y divide-line">
        {schedules.map((schedule) => (
          <ScheduleForm
            key={`${schedule.name}:${schedule.enabled}:${schedule.intervalMinutes}`}
            schedule={schedule}
            running={running}
            blocker={blockers[schedule.name]}
            demo={demo}
          />
        ))}
      </div>
    </section>
  );
}

function ScheduleForm({
  schedule,
  running,
  blocker,
  demo,
}: {
  schedule: Schedule;
  running: boolean;
  blocker: string | null;
  demo: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(Boolean(schedule.enabled));
  const [minutes, setMinutes] = useState(String(schedule.intervalMinutes));
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    operation: "save" | "run";
    lastStartedAt: string | null;
  } | null>(null);
  const visibleResult =
    result &&
    (result.operation !== "run" ||
      !result.ok ||
      result.lastStartedAt === schedule.lastStartedAt)
      ? result
      : null;
  const [pending, startTransition] = useTransition();
  const definition = scheduleDefinitions[schedule.name];
  const stamp = (value: string | null) =>
    value ? `${value.slice(0, 19).replace("T", " ")} UTC` : "Not yet";
  function act(operation: "save" | "run") {
    const form = new FormData();
    form.set("enabled", enabled ? "on" : "off");
    form.set("intervalMinutes", minutes);
    startTransition(async () => {
      setResult({
        ...(await scheduleAction(schedule.name, operation, form)),
        operation,
        lastStartedAt: schedule.lastStartedAt,
      });
      router.refresh();
    });
  }
  return (
    <form
      className="space-y-3 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        act("save");
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{definition.title}</h3>
          <p className="mt-1 text-sm text-muted">{definition.description}</p>
        </div>
        <span className="rounded-md bg-panel px-2 py-1 text-xs">
          {schedule.lastStatus === "running"
            ? "Running now"
            : schedule.enabled
              ? "Scheduled"
              : "Paused"}
        </span>
      </div>
      {blocker && <p className="text-sm text-amber-800">{blocker}</p>}
      {visibleResult && (
        <p
          role={visibleResult.ok ? "status" : "alert"}
          className={`text-sm ${visibleResult.ok ? "text-emerald-800" : "text-rose-700"}`}
        >
          {visibleResult.message}
        </p>
      )}
      {schedule.lastError && (
        <p
          role="status"
          className="rounded-md bg-amber-50 p-3 text-sm text-amber-900"
        >
          {schedule.lastStatus === "failed"
            ? "Last run failed: "
            : "Last run: "}
          {schedule.lastError}
        </p>
      )}
      <div className="grid gap-2 text-xs text-muted sm:grid-cols-3">
        <p>
          Last run: {stamp(schedule.lastStartedAt)}
          {schedule.lastStatus !== "never" && ` (${schedule.lastStatus})`}
        </p>
        <p>Last success: {stamp(schedule.lastSuccessAt)}</p>
        <p>
          Next run: {schedule.enabled ? stamp(schedule.nextRunAt) : "Paused"}
          {schedule.enabled && !running ? " · waiting for scheduler" : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex h-10 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="enabled"
            className="size-4 accent-accent"
            checked={enabled}
            disabled={pending || demo || (Boolean(blocker) && !enabled)}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Enable {definition.title.toLowerCase()}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">
            Run every (minutes)
          </span>
          <input
            type="number"
            name="intervalMinutes"
            aria-label={`${definition.title} interval in minutes`}
            min={1}
            max={10080}
            required
            value={minutes}
            disabled={pending || demo}
            onChange={(event) => setMinutes(event.target.value)}
            className="h-10 w-32 rounded-md border border-line px-3 text-sm"
          />
        </label>
        <button
          disabled={pending || demo}
          className="h-10 rounded-md border border-line px-3 text-sm font-medium disabled:opacity-50"
        >
          Save schedule
        </button>
        <button
          type="button"
          disabled={
            pending ||
            demo ||
            !running ||
            !schedule.enabled ||
            schedule.lastStatus === "running" ||
            Boolean(blocker)
          }
          onClick={() => act("run")}
          className="h-10 rounded-md border border-line px-3 text-sm font-medium disabled:opacity-50"
        >
          Run now
        </button>
      </div>
    </form>
  );
}
