import { env } from "@/modules/core/env";

export const modules = [
  {
    key: "smtp",
    label: "SMTP sending",
    enabled: env.SMTP_ENABLED,
    envFlag: "SMTP_ENABLED",
    jobs: ["sendEmail"]
  },
  {
    key: "imap",
    label: "IMAP sync",
    enabled: env.IMAP_ENABLED,
    envFlag: "IMAP_ENABLED",
    jobs: ["mailSync"]
  },
  {
    key: "telegram",
    label: "Telegram notifications",
    enabled: env.TELEGRAM_ENABLED,
    envFlag: "TELEGRAM_ENABLED",
    jobs: ["notifyFollowups", "notifyReplies", "notifyFailures"]
  },
  {
    key: "contactForms",
    label: "Contact form tracking",
    enabled: true,
    envFlag: null,
    jobs: []
  },
  {
    key: "analytics",
    label: "Analytics",
    enabled: true,
    envFlag: null,
    jobs: []
  }
] as const;
