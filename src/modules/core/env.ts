import "dotenv/config";
import { z } from "zod";
import { readConnectionValues } from "../connections/store";

process.env.TZ ||= "UTC";

const demoModeFromEnv = process.env.DEMO_MODE === "true";
const defaultDatabasePath = demoModeFromEnv
  ? ".data/demo.sqlite"
  : ".data/app.sqlite";
const defaultBackupDir = demoModeFromEnv
  ? ".data/demo-backups"
  : ".data/backups";
const defaultAppUrl = "http://localhost:3000";

const booleanFromString = z
  .enum(["true", "false"])
  .optional()
  .default("false")
  .transform((value) => value === "true");

const portFromString = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : fallback))
    .pipe(z.number().int().positive());

const EnvSchema = z.object({
  TZ: z.string().default("UTC"),
  APP_URL: z.string().url().default(defaultAppUrl),
  DEMO_MODE: booleanFromString,
  DATABASE_PATH: z.string().default(defaultDatabasePath),
  SEED_DEMO_DATA: booleanFromString,

  APP_BASIC_AUTH_ENABLED: booleanFromString,
  APP_BASIC_AUTH_USER: z.string().optional(),
  APP_BASIC_AUTH_PASSWORD: z.string().optional(),

  SMTP_ENABLED: booleanFromString,
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: portFromString(1025),
  SMTP_SECURE: booleanFromString,
  SMTP_SECURITY: z.enum(["plain", "starttls", "tls", "auto"]).optional(),
  SMTP_TLS_VERIFY: booleanFromString.default("true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_FROM_IDENTITIES: z.string().optional(),

  IMAP_ENABLED: booleanFromString,
  IMAP_HOST: z.string().default("127.0.0.1"),
  IMAP_PORT: portFromString(1143),
  IMAP_SECURITY: z.enum(["plain", "starttls", "tls", "auto"]).optional(),
  IMAP_SECURE: booleanFromString,
  IMAP_TLS_VERIFY: booleanFromString.default("true"),
  IMAP_USER: z.string().optional(),
  IMAP_PASS: z.string().optional(),
  IMAP_MAILBOXES: z.string().default("INBOX,Sent"),
  IMAP_LOOKBACK_DAYS: portFromString(90),
  IMAP_AUTO_RESYNC_DAYS: portFromString(90),

  TELEGRAM_ENABLED: booleanFromString,
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  EMAILLISTVERIFY_ENABLED: booleanFromString,
  EMAILLISTVERIFY_API_KEY: z.string().optional(),
  EMAILLISTVERIFY_TIMEOUT_MS: portFromString(15000),
  EMAILLISTVERIFY_BATCH_SIZE: portFromString(25),

  AI_ENABLED: booleanFromString,
  AI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_AUTO_SEND: booleanFromString,
  AI_DAILY_SEND_LIMIT: portFromString(5),

  BACKUP_DIR: z.string().default(defaultBackupDir),
  B2_REMOTE: z.string().optional()
});

export function getRuntimeEnv() {
  const values = { ...readConnectionValues(), ...process.env };
  // Legacy environment configuration remains authoritative over saved settings.
  if (process.env.SMTP_SECURE !== undefined && process.env.SMTP_SECURITY === undefined) delete values.SMTP_SECURITY;
  if (process.env.IMAP_SECURE !== undefined && process.env.IMAP_SECURITY === undefined) delete values.IMAP_SECURITY;
  return EnvSchema.parse(values);
}

// Connections are read on use, so a settings save reaches both the web app and future workers.
export const env = new Proxy(EnvSchema.parse(process.env), {
  get: (_target, property: string) => Reflect.get(getRuntimeEnv(), property)
});
