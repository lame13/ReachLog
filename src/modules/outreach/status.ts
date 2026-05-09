export function isSendBlockedStatus(status: string | null | undefined) {
  const normalized = (status ?? "").toLowerCase();

  return (
    normalized.includes("dead") ||
    normalized.includes("bounced") ||
    normalized.includes("skipped") ||
    normalized.includes("blocked") ||
    normalized.includes("do not send")
  );
}
