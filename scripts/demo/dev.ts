import { spawn } from "node:child_process";

const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1"], {
  stdio: "inherit",
  env: { ...process.env, DEMO_MODE: "true", SEED_DEMO_DATA: "true", DATABASE_PATH: ".data/demo.sqlite" }
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => { process.exitCode = code ?? 1; });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
