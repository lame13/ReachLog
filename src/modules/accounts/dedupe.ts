import { normalizeDomain } from "@/modules/outreach/dedupe";

/**
 * Accounts are companies. They are deduped by domain when one is known and by
 * a normalised name otherwise, so "Acme Hosting" and "acme hosting" land in the
 * same account while two genuinely different companies stay apart.
 */
export function accountDedupeKey({
  name,
  domain
}: {
  name: string;
  domain?: string | null;
}) {
  const normalizedDomain = normalizeAccountDomain(domain);

  if (normalizedDomain) {
    return `domain:${normalizedDomain}`;
  }

  const normalizedName = normalizeCompanyName(name);

  return normalizedName ? `name:${normalizedName}` : "";
}

export function normalizeAccountDomain(value: string | null | undefined) {
  const domain = normalizeDomain(value ?? "");

  return domain && domain !== "unknown" ? domain : "";
}

export function normalizeCompanyName(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,]+$/, "");
}

export function accountDomainFromWebsite(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  try {
    return normalizeAccountDomain(new URL(value).hostname);
  } catch {
    return normalizeAccountDomain(value);
  }
}

/**
 * Picks the best domain hint for a company from what a target already knows:
 * explicit website, the contact's email domain, or the source URL.
 */
export function inferAccountDomain({
  websiteUrl,
  contactEmail,
  sourceUrl
}: {
  websiteUrl?: string | null;
  contactEmail?: string | null;
  sourceUrl?: string | null;
}) {
  for (const candidate of [websiteUrl, contactEmail, sourceUrl]) {
    if (!candidate) {
      continue;
    }

    const domain = candidate.includes("@")
      ? normalizeAccountDomain(candidate.split("@").pop())
      : accountDomainFromWebsite(candidate);

    if (domain) {
      return domain;
    }
  }

  return "";
}
