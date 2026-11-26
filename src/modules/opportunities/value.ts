const supportedCurrencies = [
  "USD",
  "EUR",
  "GBP",
  "THB",
  "AUD",
  "CAD",
  "SGD",
  "JPY",
  "INR"
] as const;

export type CurrencyCode = (typeof supportedCurrencies)[number];

export const currencyOptions = supportedCurrencies.map((code) => ({
  code,
  label: `${code} ${currencySymbol(code)}`
}));

export function normalizeCurrency(value: string | null | undefined): CurrencyCode {
  const code = (value ?? "").trim().toUpperCase();

  return supportedCurrencies.includes(code as CurrencyCode)
    ? (code as CurrencyCode)
    : "USD";
}

export function parseDealValueToCents(
  value: FormDataEntryValue | string | null | undefined
) {
  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    return undefined;
  }

  const amount = Number(text.replaceAll(",", ""));

  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) {
    return undefined;
  }

  const cents = Math.round(amount * 100);
  return cents / 100 === amount ? cents : undefined;
}

export function centsToInputValue(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }

  return (value / 100).toFixed(2);
}

export function dateAtNine(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T09:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatMoney(
  cents: number | null | undefined,
  currency: string | null | undefined,
  options: { compact?: boolean; showZero?: boolean } = {}
) {
  if ((cents === null || cents === undefined) && !options.showZero) {
    return "";
  }

  const amount = (cents ?? 0) / 100;

  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: normalizeCurrency(currency),
      notation: options.compact ? "compact" : "standard",
      maximumFractionDigits: options.compact ? 1 : 2
    }).format(amount);
  } catch {
    return `${normalizeCurrency(currency)} ${amount.toFixed(2)}`;
  }
}

export function formatPipelineValue(
  values: Array<{ currency: string; cents: number }>
) {
  const totals = new Map<string, number>();

  for (const value of values) {
    const currency = normalizeCurrency(value.currency);
    totals.set(currency, (totals.get(currency) ?? 0) + value.cents);
  }

  if (!totals.size) {
    return "No value set";
  }

  return Array.from(totals)
    .map(([currency, cents]) => formatMoney(cents, currency, { compact: true }))
    .join(" + ");
}

function currencySymbol(currency: CurrencyCode) {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol"
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? currency
    );
  } catch {
    return currency;
  }
}
