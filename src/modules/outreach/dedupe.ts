export function emailDedupeKey(email: string) {
  return `email:${email.trim().toLowerCase()}`;
}

export function domainDedupeKey(domain: string) {
  return `domain:${normalizeDomain(domain)}`;
}

export function contactFormDedupeKey(formUrl: string) {
  const url = new URL(formUrl);
  return `form:${normalizeDomain(url.hostname)}${url.pathname.replace(/\/$/, "")}`;
}

export function sourceDedupeKey(sourceType: string, sourceUrl: string) {
  return `${sourceType}:${sourceUrl.trim()}`;
}

export function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}
