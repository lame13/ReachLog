import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import dotenv from "dotenv";

const require = createRequire(import.meta.url);
if (process.env.DOTENV_CONFIG_PATH)
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH });
// Load Next's development env files before starting either process so the
// web app and scheduler agree on configuration and its precedence.
const nextRequire = createRequire(require.resolve("next/package.json"));
nextRequire("@next/env").loadEnvConfig(process.cwd(), true);
const env = {
  ...process.env,
  REACHLOG_SOURCE_WORKERS: "true",
  REACHLOG_WORKER_DIR: path.resolve("workers"),
};
const app = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    ...process.argv.slice(2),
  ],
  { env, stdio: "inherit" },
);
const scheduler =
  env.DEMO_MODE !== "true" && env.REACHLOG_SCHEDULER_ENABLED !== "false"
    ? spawn(
        process.execPath,
        [
          "--import",
          require.resolve("tsx"),
          path.resolve("workers/scheduler.ts"),
        ],
        { env, stdio: ["ignore", "inherit", "inherit", "ipc"] },
      )
    : null;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    app.kill(signal);
    scheduler?.kill(signal);
  });
app.on("error", () => {
  scheduler?.kill("SIGTERM");
  process.exitCode = 1;
});
app.on("exit", (code) => {
  scheduler?.kill("SIGTERM");
  process.exitCode = code ?? 1;
});
scheduler?.on("error", () =>
  console.error(
    "Could not start background scheduling. Restart the development server to retry.",
  ),
);
