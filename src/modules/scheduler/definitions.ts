export const scheduleNames = ["mail-sync", "followup-check", "ai", "backup"] as const;
export type ScheduleName = (typeof scheduleNames)[number];
export const scheduleDefinitions: Record<
  ScheduleName,
  { title: string; description: string }
> = {
  "mail-sync": {
    title: "Mailbox sync",
    description:
      "Import sent messages and replies from your selected mailboxes.",
  },
  "followup-check": {
    title: "Follow-up reminders",
    description:
      "Send Telegram reminders for due follow-ups. AI follow-up sending is controlled separately.",
  },
  ai: {
    title: "AI automation",
    description:
      "Triage new replies, draft follow-ups, and capture unlinked inbound leads.",
  },
  backup: {
    title: "Database backups",
    description:
      "Save a compressed copy of your database in your backup folder.",
  },
};
export type Schedule = {
  name: ScheduleName;
  enabled: number;
  intervalMinutes: number;
  nextRunAt: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSuccessAt: string | null;
  lastStatus:
    | "never"
    | "running"
    | "success"
    | "failed"
    | "skipped"
    | "interrupted";
  lastError: string | null;
};
