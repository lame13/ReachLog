export const analyticsModule = {
  key: "analytics",
  enabled: true,
  jobs: [],
  eventTypes: [
    "target_created",
    "email_sent",
    "email_received",
    "form_submitted",
    "followup_due",
    "followup_sent",
    "reply_received",
    "bounced",
    "won",
    "dead"
  ]
} as const;
