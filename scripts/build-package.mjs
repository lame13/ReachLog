import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);
// Never load runtime mail settings or the database while building a package.
for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  try {
    await readFile(file);
    throw new Error(`Move ${file} outside the source checkout before building a release.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const scratch = mkdtempSync(path.join(tmpdir(), "reachlog-build-"));
process.once("exit", () => rmSync(scratch, { recursive: true, force: true }));
const env = {
  ...process.env, NEXT_TELEMETRY_DISABLED: "1", DEMO_MODE: "false", SEED_DEMO_DATA: "false",
  REACHLOG_DATA_DIR: scratch, REACHLOG_CONNECTIONS_PATH: path.join(scratch, "connections.json"),
  DATABASE_PATH: path.join(scratch, "app.sqlite"), BACKUP_DIR: path.join(scratch, "backups"),
  DOTENV_CONFIG_PATH: path.join(scratch, ".env"), REACHLOG_SCHEDULER_ENABLED: "false"
};
for (const key of Object.keys(env)) {
  if (/^(SMTP_|IMAP_|TELEGRAM_|EMAILLISTVERIFY_|AI_|APP_BASIC_AUTH_|NEXT_PUBLIC_)/.test(key)) delete env[key];
}
await rm("dist", { recursive: true, force: true });
const next = spawnSync(process.execPath, [require.resolve("next/dist/bin/next"), "build", "--webpack"], { env, stdio: "inherit" });
if (next.status !== 0) process.exit(next.status ?? 1);

await mkdir("dist/app/.next", { recursive: true });
for (const entry of await readdir(".next")) {
  if (!["server", "static", "BUILD_ID"].includes(entry) && !entry.endsWith(".json")) continue;
  await cp(`.next/${entry}`, `dist/app/.next/${entry}`, {
    recursive: true,
    filter: (file) => !file.endsWith(".map") && !file.endsWith(".nft.json")
  });
}
const requiredFile = "dist/app/.next/required-server-files.json";
const required = JSON.parse(await readFile(requiredFile, "utf8"));
required.appDir = ".";
required.relativeAppDir = "";
await writeFile(requiredFile, JSON.stringify(required));
await cp("next.config.mjs", "dist/app/next.config.mjs");
await writeFile("dist/app/package.json", JSON.stringify({ private: true }));
const options = { bundle: true, platform: "node", target: "node22", format: "cjs", packages: "external", tsconfig: "tsconfig.json" };
await build({ ...options, entryPoints: ["src/cli.ts"], outfile: "dist/cli.cjs" });
await chmod("dist/cli.cjs", 0o755);
await build({ ...options, entryPoints: (await readdir("workers")).filter((file) => file.endsWith(".ts")).map((file) => `workers/${file}`), outdir: "dist/workers", outExtension: { ".js": ".cjs" } });
console.log("ReachLog package built. Run npm pack, then test the tarball in an empty folder.");
