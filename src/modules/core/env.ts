import "dotenv/config";
import { z } from "zod";

process.env.TZ ||= "Asia/Bangkok";

const booleanFromString = z
  .string()
  .optional()
  .default("false")
  .transform((value) => value === "true");

const portFromString = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : fallback));

const EnvSchema = z.object({
  TZ: z.string().default("Asia/Bangkok"),
  DATABASE_PATH: z.string().default(".data/app.sqlite"),
  SEED_DEMO_DATA: booleanFromString,

  APP_BASIC_AUTH_ENABLED: booleanFromString,
  APP_BASIC_AUTH_USER: z.string().optional(),
  APP_BASIC_AUTH_PASSWORD: z.string().optional(),

  SMTP_ENABLED: booleanFromString,
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: portFromString(1025),
  SMTP_SECURE: booleanFromString,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  IMAP_ENABLED: booleanFromString,
  IMAP_HOST: z.string().default("127.0.0.1"),
  IMAP_PORT: portFromString(1143),
  IMAP_SECURE: booleanFromString,
  IMAP_USER: z.string().optional(),
  IMAP_PASS: z.string().optional(),
  IMAP_MAILBOXES: z.string().default("INBOX,Sent"),
  IMAP_LOOKBACK_DAYS: portFromString(90),

  TELEGRAM_ENABLED: booleanFromString,
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  EMAILLISTVERIFY_ENABLED: booleanFromString,
  EMAILLISTVERIFY_API_KEY: z.string().optional(),
  EMAILLISTVERIFY_TIMEOUT_MS: portFromString(15000),
  EMAILLISTVERIFY_BATCH_SIZE: portFromString(25),

  BACKUP_DIR: z.string().default(".data/backups"),
  B2_REMOTE: z.string().optional()
});

export const env = EnvSchema.parse(process.env);
