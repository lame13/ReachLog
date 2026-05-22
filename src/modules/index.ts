import { env } from "@/modules/core/env";

export const modules = [
  {
    key: "smtp",
    label: "SMTP sending",
    enabled: env.SMTP_ENABLED && !env.DEMO_MODE,
    envFlag: "SMTP_ENABLED",
    jobs: ["sendEmail"]
  },
  {
    key: "imap",
    label: "IMAP sync",
    enabled: env.IMAP_ENABLED && !env.DEMO_MODE,
    envFlag: "IMAP_ENABLED",
    jobs: ["mailSync"]
  },
  {
    key: "telegram",
    label: "Telegram notifications",
    enabled: env.TELEGRAM_ENABLED && !env.DEMO_MODE,
    envFlag: "TELEGRAM_ENABLED",
    jobs: ["notifyFollowups", "notifyReplies", "notifyFailures"]
  },
  {
    key: "emaillistverify",
    label: "EmailListVerify",
    enabled: env.EMAILLISTVERIFY_ENABLED && !env.DEMO_MODE,
    envFlag: "EMAILLISTVERIFY_ENABLED",
    jobs: ["emailVerify"]
  },
  {
    key: "demo",
    label: "Demo safety mode",
    enabled: env.DEMO_MODE,
    envFlag: "DEMO_MODE",
    jobs: []
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
