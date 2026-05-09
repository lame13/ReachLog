import "dotenv/config";
import { z } from "zod";

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
  DATABASE_PATH: z.string().default(".data/app.sqlite"),

  SMTP_ENABLED: booleanFromString,
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: portFromString(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  IMAP_ENABLED: booleanFromString,
  IMAP_HOST: z.string().default("127.0.0.1"),
  IMAP_PORT: portFromString(1143),
  IMAP_USER: z.string().optional(),
  IMAP_PASS: z.string().optional(),

  TELEGRAM_ENABLED: booleanFromString,
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  BACKUP_DIR: z.string().default(".data/backups"),
  B2_REMOTE: z.string().optional()
});

export const env = EnvSchema.parse(process.env);
