import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  connectionDefinitions,
  connectionGroups,
  type ConnectionCheck,
  type ConnectionGroup,
  type ConnectionView,
} from "./fields";

const checkSchema = z.object({
  fingerprint: z.string(),
  checkedAt: z.string(),
  ok: z.boolean(),
  message: z.string(),
  mailboxes: z.array(z.string()).optional(),
});
const settingsSchema = z.object({
  version: z.literal(1),
  values: z.record(z.string().max(16384)),
  checks: z.record(checkSchema),
});
type Settings = z.infer<typeof settingsSchema>;
const allowedKeys = new Set(
  connectionGroups.flatMap((group) => [
    connectionDefinitions[group].enabledKey,
    ...connectionDefinitions[group].fields.map((field) => field.key),
  ]),
);
let cache: { file: string; stamp: string; settings: Settings } | undefined;

export class ConnectionInputError extends Error {
  constructor(public readonly fields: Record<string, string>) {
    super("Check the highlighted connection settings.");
  }
}

export function connectionsPath() {
  return path.resolve(
    process.env.REACHLOG_CONNECTIONS_PATH ??
      path.join(
        process.env.REACHLOG_DATA_DIR ??
          path.dirname(process.env.DATABASE_PATH ?? ".data/app.sqlite"),
        process.env.DEMO_MODE === "true"
          ? "demo-connections.json"
          : "connections.json",
      ),
  );
}

function readSettings(): Settings {
  const file = connectionsPath();
  try {
    const info = statSync(file);
    const stamp = `${info.mtimeMs}:${info.ctimeMs}:${info.size}:${info.ino}`;
    if (cache?.file === file && cache.stamp === stamp) return cache.settings;
    const settings = settingsSchema.parse(
      JSON.parse(readFileSync(file, "utf8")),
    );
    settings.values = Object.fromEntries(
      Object.entries(settings.values).filter(([key]) => allowedKeys.has(key)),
    );
    cache = { file, stamp, settings };
    return settings;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { version: 1, values: {}, checks: {} };
    throw new Error(
      "Could not read saved connections. Check the connections.json file in your data folder.",
    );
  }
}

function writeSettings(settings: Settings) {
  const file = connectionsPath();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, file);
    chmodSync(file, 0o600);
    cache = undefined;
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function readConnectionValues() {
  return { ...readSettings().values };
}

export function effectiveConnectionValues(
  saved = readConnectionValues(),
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {
    ...saved,
    ...process.env,
  };
  values.IMAP_MAILBOXES ??= "INBOX,Sent";
  values.SMTP_FROM ??=
    values.SMTP_FROM_IDENTITIES?.split("|")[0]?.split("::")[0]?.trim() ||
    values.SMTP_USER;
  return values;
}

function effectiveField(
  key: string,
  values: Record<string, string | undefined>,
  fallback: string,
) {
  // Existing environment-only configurations use the same defaults as the transport.
  // An empty setup form suggests conventional remote-server settings until saved.
  if (values.SMTP_HOST) {
    if (key === "SMTP_PORT") fallback = "1025";
    if (key === "SMTP_SECURITY") fallback = "auto";
  }
  if (values.IMAP_HOST) {
    if (key === "IMAP_PORT") fallback = "1143";
    if (key === "IMAP_SECURITY") fallback = "auto";
  }
  if (key.endsWith("_SECURITY")) {
    const legacy = key.replace("_SECURITY", "_SECURE");
    if (process.env[legacy] !== undefined && process.env[key] === undefined)
      return process.env[legacy] === "true" ? "tls" : "auto";
    if (!values[key] && values[legacy] !== undefined)
      return values[legacy] === "true" ? "tls" : "auto";
  }
  return values[key] ?? fallback;
}

export function connectionFingerprint(group: ConnectionGroup) {
  const definition = connectionDefinitions[group];
  const values = effectiveConnectionValues();
  const fields = definition.fields.map((field) => [
    field.key,
    effectiveField(field.key, values, field.defaultValue),
  ]);
  // Changing per-sender SMTP credentials also invalidates the connection check.
  if (group === "smtp")
    fields.push(["SMTP_FROM_IDENTITIES", values.SMTP_FROM_IDENTITIES ?? ""]);
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export function getConnectionView(group: ConnectionGroup): ConnectionView {
  const definition = connectionDefinitions[group];
  const effective = effectiveConnectionValues();
  const values: Record<string, string> = {};
  const secrets: Record<string, boolean> = {};
  const overridden = [
    definition.enabledKey,
    ...definition.fields.map((field) => field.key),
  ].filter((key) => process.env[key] !== undefined);
  for (const field of definition.fields) {
    const value = effectiveField(field.key, effective, field.defaultValue);
    if (field.type === "password") secrets[field.key] = Boolean(value);
    else values[field.key] = value;
    if (
      field.key.endsWith("_SECURITY") &&
      process.env[field.key.replace("_SECURITY", "_SECURE")] !== undefined
    )
      overridden.push(field.key);
  }
  let configured = true;
  try {
    validateConnection(group, effective);
  } catch {
    configured = false;
  }
  const recorded = readSettings().checks[group];
  const check =
    recorded?.fingerprint === connectionFingerprint(group)
      ? {
          checkedAt: recorded.checkedAt,
          ok: recorded.ok,
          message: recorded.message,
          mailboxes: recorded.mailboxes,
        }
      : null;
  return {
    group,
    values,
    secrets,
    overridden,
    enabled: effective[definition.enabledKey] === "true",
    configured,
    check,
  };
}

export function validateConnection(
  group: ConnectionGroup,
  values: Record<string, string | undefined>,
  requireComplete = true,
) {
  const errors: Record<string, string> = {};
  const required =
    group === "smtp"
      ? ["SMTP_HOST", "SMTP_FROM"]
      : group === "imap"
        ? ["IMAP_HOST", "IMAP_USER", "IMAP_PASS", "IMAP_MAILBOXES"]
        : group === "telegram"
          ? ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]
          : ["AI_BASE_URL", "AI_MODEL"];
  for (const key of required)
    if (requireComplete && !values[key]?.trim())
      errors[key] = "This field is required.";
  for (const field of connectionDefinitions[group].fields) {
    const value = values[field.key];
    if (value === undefined) continue;
    if (
      value.length > 16384 ||
      (field.type !== "password" && /[\r\n\0]/.test(value))
    )
      errors[field.key] = "Enter a valid value on one line.";
    if (
      field.type === "number" &&
      (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
    )
      errors[field.key] = "Use a port between 1 and 65535.";
    if (field.type === "checkbox" && !["true", "false"].includes(value))
      errors[field.key] = "Choose on or off.";
    if (field.options && !field.options.includes(value))
      errors[field.key] = "Choose an encryption option.";
    if (
      field.key.endsWith("_HOST") &&
      value &&
      !/^[a-zA-Z0-9.:[\]_-]+$/.test(value)
    )
      errors[field.key] =
        "Enter a hostname or IP address, without a URL or port.";
  }
  if (group === "smtp" && requireComplete) {
    const from = values.SMTP_FROM?.match(/<([^>]+)>/)?.[1] ?? values.SMTP_FROM;
    if (!z.string().email().safeParse(from).success)
      errors.SMTP_FROM = "Enter a valid sender email.";
    if (Boolean(values.SMTP_USER) !== Boolean(values.SMTP_PASS))
      errors.SMTP_PASS =
        "Provide both a username and password, or leave both empty for a local relay.";
  }
  if (
    group === "imap" &&
    requireComplete &&
    !values.IMAP_MAILBOXES?.split(",").some((mailbox) => mailbox.trim())
  )
    errors.IMAP_MAILBOXES = "Select at least one mailbox.";
  if (
    group === "telegram" &&
    values.TELEGRAM_BOT_TOKEN &&
    !/^\d+:[A-Za-z0-9_-]+$/.test(values.TELEGRAM_BOT_TOKEN)
  )
    errors.TELEGRAM_BOT_TOKEN = "Enter the token supplied by BotFather.";
  if (group === "ai") {
    const baseUrl = values.AI_BASE_URL?.trim();
    if (baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
          errors.AI_BASE_URL = "Use an http or https URL without embedded credentials.";
      } catch {
        errors.AI_BASE_URL = "Enter a valid endpoint URL.";
      }
    }
    if (values.AI_MODEL && (values.AI_MODEL.length > 200 || /[\r\n\0]/.test(values.AI_MODEL)))
      errors.AI_MODEL = "Enter one model name on a single line.";
    if (values.AI_DAILY_SEND_LIMIT && Number(values.AI_DAILY_SEND_LIMIT) > 100)
      errors.AI_DAILY_SEND_LIMIT = "Choose a daily limit of 100 or less.";
  }
  if (Object.keys(errors).length) throw new ConnectionInputError(errors);
}

export function saveConnection(group: ConnectionGroup, input: FormData) {
  const settings = readSettings();
  const values = { ...settings.values };
  const definition = connectionDefinitions[group];
  const overridden = getConnectionView(group).overridden;
  for (const field of definition.fields) {
    if (overridden.includes(field.key)) continue;
    const raw = input.get(field.key);
    if (typeof raw !== "string") continue;
    if (field.type === "password" && !raw) continue;
    values[field.key] = field.type === "password" ? raw : raw.trim();
  }
  if (!overridden.includes(definition.enabledKey))
    values[definition.enabledKey] =
      input.get(definition.enabledKey) === "true" ? "true" : "false";
  const effective = effectiveConnectionValues(values);
  // An empty disabled connection can be saved; partially configured or enabled connections must be valid.
  const hasInput = definition.fields.some((field) =>
    field.type === "password"
      ? Boolean(effective[field.key])
      : field.key.endsWith("_HOST") || field.key.endsWith("_CHAT_ID")
        ? Boolean(effective[field.key])
        : false,
  );
  validateConnection(
    group,
    effective,
    effective[definition.enabledKey] === "true" || hasInput,
  );
  writeSettings({ ...settings, values });
  return getConnectionView(group);
}

export function recordConnectionCheck(
  group: ConnectionGroup,
  check: ConnectionCheck,
) {
  if (check.fingerprint !== connectionFingerprint(group)) return false;
  const settings = readSettings();
  writeSettings({
    ...settings,
    checks: { ...settings.checks, [group]: check },
  });
  return true;
}
