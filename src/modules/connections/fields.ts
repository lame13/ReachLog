export const connectionGroups = ["smtp", "imap", "telegram", "ai"] as const;
export type ConnectionGroup = (typeof connectionGroups)[number];

export type ConnectionField = {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "checkbox" | "select";
  defaultValue: string;
  options?: readonly string[];
  hint?: string;
};

export const connectionDefinitions: Record<
  ConnectionGroup,
  {
    title: string;
    description: string;
    enabledKey: string;
    fields: ConnectionField[];
  }
> = {
  smtp: {
    title: "Email sending",
    description: "Connect the SMTP server you use to send individual emails.",
    enabledKey: "SMTP_ENABLED",
    fields: [
      { key: "SMTP_HOST", label: "SMTP host", type: "text", defaultValue: "" },
      {
        key: "SMTP_PORT",
        label: "SMTP port",
        type: "number",
        defaultValue: "587",
      },
      {
        key: "SMTP_USER",
        label: "SMTP username",
        type: "text",
        defaultValue: "",
      },
      {
        key: "SMTP_PASS",
        label: "SMTP password",
        type: "password",
        defaultValue: "",
        hint: "Leave blank to keep the saved password.",
      },
      {
        key: "SMTP_FROM",
        label: "Sender email",
        type: "text",
        defaultValue: "",
        hint: "For example, Alex <alex@example.com>.",
      },
      {
        key: "SMTP_SECURITY",
        label: "SMTP encryption",
        type: "select",
        defaultValue: "starttls",
        options: ["starttls", "tls", "auto", "plain"],
      },
      {
        key: "SMTP_TLS_VERIFY",
        label: "Verify SMTP certificate",
        type: "checkbox",
        defaultValue: "true",
      },
    ],
  },
  imap: {
    title: "Mailbox sync",
    description:
      "Connect IMAP to bring sent messages and replies into ReachLog.",
    enabledKey: "IMAP_ENABLED",
    fields: [
      { key: "IMAP_HOST", label: "IMAP host", type: "text", defaultValue: "" },
      {
        key: "IMAP_PORT",
        label: "IMAP port",
        type: "number",
        defaultValue: "993",
      },
      {
        key: "IMAP_USER",
        label: "IMAP username",
        type: "text",
        defaultValue: "",
      },
      {
        key: "IMAP_PASS",
        label: "IMAP password",
        type: "password",
        defaultValue: "",
        hint: "Leave blank to keep the saved password.",
      },
      {
        key: "IMAP_SECURITY",
        label: "IMAP encryption",
        type: "select",
        defaultValue: "tls",
        options: ["starttls", "tls", "auto", "plain"],
      },
      {
        key: "IMAP_TLS_VERIFY",
        label: "Verify IMAP certificate",
        type: "checkbox",
        defaultValue: "true",
      },
      {
        key: "IMAP_MAILBOXES",
        label: "Mailboxes to sync",
        type: "text",
        defaultValue: "INBOX,Sent",
        hint: "Separate mailbox names with commas. Test the connection to discover available mailboxes.",
      },
    ],
  },
  telegram: {
    title: "Telegram notifications",
    description:
      "Receive reminders, replies, and background task failures in Telegram.",
    enabledKey: "TELEGRAM_ENABLED",
    fields: [
      {
        key: "TELEGRAM_BOT_TOKEN",
        label: "Bot token",
        type: "password",
        defaultValue: "",
        hint: "Leave blank to keep the saved token.",
      },
      {
        key: "TELEGRAM_CHAT_ID",
        label: "Chat ID",
        type: "text",
        defaultValue: "",
        hint: "Start a conversation with your bot before testing.",
      },
    ],
  },
  ai: {
    title: "AI automation",
    description:
      "Any OpenAI-compatible chat completions endpoint. ReachLog sends the relevant email text to this provider when triage, lead capture, or follow-up drafting runs.",
    enabledKey: "AI_ENABLED",
    fields: [
      {
        key: "AI_BASE_URL",
        label: "Base URL",
        type: "text",
        defaultValue: "https://api.openai.com/v1",
        hint: "OpenAI, DeepSeek, MiMo, OpenRouter, Ollama, LM Studio, or a gateway. Include /v1 when the provider expects it.",
      },
      {
        key: "AI_API_KEY",
        label: "API key",
        type: "password",
        defaultValue: "",
        hint: "Leave blank, or use any placeholder, for a local endpoint that does not require a key.",
      },
      {
        key: "AI_MODEL",
        label: "Model",
        type: "text",
        defaultValue: "gpt-4o-mini",
        hint: "The exact model name the provider expects.",
      },
      {
        key: "AI_AUTO_SEND",
        label: "Send follow-ups automatically",
        type: "checkbox",
        defaultValue: "false",
        hint: "Only inside an existing thread, within the daily cap, and only when the thread has no newer reply.",
      },
      {
        key: "AI_DAILY_SEND_LIMIT",
        label: "Daily auto-send limit",
        type: "number",
        defaultValue: "5",
        hint: "Maximum AI-sent follow-ups per calendar day.",
      },
    ],
  },
};

export type ConnectionCheck = {
  fingerprint: string;
  checkedAt: string;
  ok: boolean;
  message: string;
  mailboxes?: string[];
};

export type ConnectionView = {
  group: ConnectionGroup;
  values: Record<string, string>;
  secrets: Record<string, boolean>;
  overridden: string[];
  enabled: boolean;
  configured: boolean;
  check: Omit<ConnectionCheck, "fingerprint"> | null;
};

export type ConnectionResult = {
  ok: boolean;
  message: string;
  view?: ConnectionView;
  errors?: Record<string, string>;
};
