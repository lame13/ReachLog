import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  acquireWorkerLock,
  releaseWorkerLock,
  renewWorkerLock,
} from "../core/db/locks";
import { env } from "../core/env";
import {
  claimSchedule,
  finishSchedule,
  getSchedules,
  recoverInterruptedSchedules,
  scheduleBlocker,
} from "./store";
import type { ScheduleName } from "./definitions";

export function startScheduler(options: {
  workerDirectory: string;
  source?: boolean;
  tickMs?: number;
}) {
  if (env.DEMO_MODE) return async () => {};
  const owner = `scheduler:${process.pid}:${randomUUID()}`;
  const active = new Map<
    ScheduleName,
    { child: ChildProcess; done: Promise<void> }
  >();
  let leader = false;
  let stopped = false;
  let draining: Promise<void> | undefined;

  function execute(name: ScheduleName) {
    const blocker = scheduleBlocker(name);
    if (blocker) {
      finishSchedule(name, "skipped", blocker);
      return;
    }
    const workerFile = path.join(
      options.workerDirectory,
      `${name}.${options.source ? "ts" : "cjs"}`,
    );
    const child = spawn(
      process.execPath,
      [
        ...(options.source ? ["--import", require.resolve("tsx")] : []),
        workerFile,
      ],
      { env: { ...process.env }, stdio: "ignore" },
    );
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeout = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      },
      name === "followup-check" ? 120_000 : 1_800_000,
    );
    const done = new Promise<void>((resolve) => {
      child.once("error", () => {
        /* The close event records failures, including spawn errors. */
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        const status = stopped
          ? "interrupted"
          : timedOut || (code !== 0 && code !== 75)
            ? "failed"
            : code === 75
              ? "skipped"
              : "success";
        const message =
          status === "success"
            ? null
            : status === "skipped"
              ? "Another worker is already running this task."
              : status === "interrupted"
                ? "ReachLog stopped before this run finished."
                : timedOut
                  ? "The task took too long and was stopped. Check the connection and retry."
                  : "The task failed. Check connection settings, backup permissions, and worker configuration, then retry.";
        try {
          // A successor may already own the schedule after our lease expires.
          if (leader) finishSchedule(name, status, message);
        } catch {
          console.error(
            "Scheduler could not record the completed task. Check the database.",
          );
        } finally {
          active.delete(name);
          resolve();
        }
      });
    });
    active.set(name, { child, done });
  }

  function tick() {
    if (stopped || draining) return;
    try {
      if (!leader) {
        leader = acquireWorkerLock("scheduler", owner, 20);
        if (!leader) return;
        recoverInterruptedSchedules();
      } else if (!renewWorkerLock("scheduler", owner, 20)) {
        releaseWorkerLock("scheduler", owner);
        leader = false;
        draining = drainWorkers().finally(() => {
          draining = undefined;
        });
        return;
      }
      for (const schedule of getSchedules()) {
        if (!active.has(schedule.name) && claimSchedule(schedule.name))
          execute(schedule.name);
      }
    } catch {
      // A busy or unavailable database is retried; never log connection secrets.
      console.error(
        "Scheduler could not update task state. Check the data folder and database availability.",
      );
    }
  }
  const timer = setInterval(tick, options.tickMs ?? 5000);
  tick();

  async function drainWorkers() {
    const running = [...active.values()];
    for (const { child } of running) child.kill("SIGTERM");
    const force = setTimeout(() => {
      for (const { child } of running) child.kill("SIGKILL");
    }, 5000);
    await Promise.allSettled(running.map(({ done }) => done));
    clearTimeout(force);
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    await (draining ?? drainWorkers());
    if (leader) releaseWorkerLock("scheduler", owner);
  }
  return stop;
}
