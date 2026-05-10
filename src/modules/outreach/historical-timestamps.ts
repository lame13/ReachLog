export function parseSourceTimestampFromValues(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const parsed = parseSourceTimestamp(value ?? "");

    if (parsed) {
      return parsed;
    }
  }

  return null;
}

export function parseSourceTimestamp(value: string) {
  return parseHistoricalTimestamp(value) ?? parseEmbeddedDateTimestamp(value);
}

export function parseFollowUpDate(value: string) {
  return parseHistoricalTimestamp(value);
}

function parseEmbeddedDateTimestamp(value: string) {
  const match = value.match(/(?:^|[\s|;,])date\s*=\s*(\d{4}-\d{2}-\d{2})(?:\b|$)/i);

  if (!match) {
    return null;
  }

  return parseHistoricalTimestamp(match[1]);
}

function parseHistoricalTimestamp(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T09:00:00`).toISOString();
  }

  const parsed = new Date(trimmed);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
