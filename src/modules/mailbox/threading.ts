export function normalizeSubject(subject: string) {
  return subject
    .trim()
    .toLowerCase()
    .replace(/^(re|fw|fwd):\s*/i, "")
    .replace(/\s+/g, " ");
}

export function extractThreadHeaderCandidates(headers: {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}) {
  return [
    headers.inReplyTo,
    ...(headers.references?.split(/\s+/).filter(Boolean) ?? []),
    headers.messageId
  ].filter(Boolean) as string[];
}
