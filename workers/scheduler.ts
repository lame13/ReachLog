import path from "node:path";
import { startScheduler } from "../src/modules/scheduler/runner";

const source = process.env.REACHLOG_SOURCE_WORKERS === "true";
const stop = startScheduler({
  workerDirectory:
    process.env.REACHLOG_WORKER_DIR ??
    (source ? path.resolve("workers") : __dirname),
  source,
});
for (const signal of ["SIGINT", "SIGTERM", "disconnect"] as const)
  process.once(signal, () => {
    void stop().finally(() => {
      if (process.connected) process.disconnect();
    });
  });
