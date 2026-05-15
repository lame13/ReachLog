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

export function isNonActionablePlatformTarget(target: {
  companyName?: string | null;
  dedupeKey?: string | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
}) {
  const values = [
    target.dedupeKey,
    target.sourceType,
    target.sourceUrl,
    target.companyName
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    values.includes("platform:contra") ||
    values.includes("platform:codementor") ||
    Boolean(
      target.sourceType?.toLowerCase() === "platform" &&
        (target.companyName?.toLowerCase().includes("contra") ||
          target.companyName?.toLowerCase().includes("codementor"))
    )
  );
}

export function isActiveThreadStatus(status: string | null | undefined) {
  const normalized = (status ?? "").toLowerCase();

  return (
    normalized.includes("active") ||
    normalized.includes("hiring_thread") ||
    normalized.includes("reply") ||
    normalized.includes("replied")
  );
}

export function isDoNotResendHardBlock(target: {
  doNotResend?: boolean | number | null;
  status?: string | null;
}) {
  return Boolean(target.doNotResend) && !isActiveThreadStatus(target.status);
}

export function isTargetActionBlocked(target: {
  companyName?: string | null;
  dedupeKey?: string | null;
  doNotResend?: boolean | number | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  status?: string | null;
}) {
  return (
    isDoNotResendHardBlock(target) ||
    isSendBlockedStatus(target.status) ||
    isNonActionablePlatformTarget(target)
  );
}
