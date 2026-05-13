import { env } from "@/modules/core/env";

export type SmtpFromIdentity = {
  value: string;
  label: string;
  email: string;
};

type ConfiguredSmtpFromIdentity = SmtpFromIdentity & {
  from: string;
  smtpUser: string | undefined;
  smtpPass: string | undefined;
};

export function getSmtpFromOptions() {
  return getConfiguredSmtpFromIdentities().map(({ value, label, email }) => ({
    value,
    label,
    email
  }));
}

export function selectSmtpIdentity(requestedFrom: string | null | undefined) {
  const options = getConfiguredSmtpFromIdentities();
  const normalized = requestedFrom?.trim().toLowerCase();

  if (normalized) {
    const match = options.find(
      (option) =>
        option.value.toLowerCase() === normalized ||
        option.from.toLowerCase() === normalized ||
        option.email.toLowerCase() === normalized
    );

    if (match) {
      return match;
    }
  }

  return options[0];
}

export function getMessageIdDomain(from: string) {
  const email = extractEmailAddress(from);
  const domain = email.split("@")[1]?.trim().toLowerCase();

  return domain || "reachlog.local";
}

function getConfiguredSmtpFromIdentities() {
  const rawValues = env.SMTP_FROM_IDENTITIES?.trim()
    ? env.SMTP_FROM_IDENTITIES.split("|")
    : [env.SMTP_FROM, env.SMTP_USER];
  const seen = new Set<string>();
  const options: ConfiguredSmtpFromIdentity[] = [];

  for (const rawValue of rawValues) {
    const parsed = parseIdentityConfig(rawValue);
    const value = parsed.from;

    if (!value || seen.has(value)) {
      continue;
    }

    const email = extractEmailAddress(value);

    if (!email) {
      continue;
    }

    seen.add(value);
    options.push({
      value,
      from: value,
      label: value,
      email,
      smtpUser: parsed.smtpUser ?? env.SMTP_USER,
      smtpPass: parsed.smtpPass ?? env.SMTP_PASS
    });
  }

  return options.length
    ? options
    : [
        {
          value: "me@example.local",
          from: "me@example.local",
          label: "me@example.local",
          email: "me@example.local",
          smtpUser: env.SMTP_USER,
          smtpPass: env.SMTP_PASS
        }
      ];
}

function parseIdentityConfig(value: string | undefined) {
  const [fromPart, userPart, ...passParts] = (value ?? "")
    .split("::")
    .map((part) => part.trim());
  const smtpPass = passParts.join("::").trim();

  return {
    from: fromPart,
    smtpUser: userPart || undefined,
    smtpPass: smtpPass || undefined
  };
}

function extractEmailAddress(value: string) {
  const bracketMatch = value.match(/<([^>]+)>/);
  const candidate = (bracketMatch?.[1] ?? value).trim();
  const emailMatch = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  return emailMatch?.[0] ?? "";
}
