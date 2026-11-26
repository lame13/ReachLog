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
  const text = String(value ?? "")
    .trim()
    .replaceAll(",", "");

  if (!text) {
    return null;
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    return undefined;
  }

  const amount = Number(text);

  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) {
    return undefined;
  }

  return Math.round(amount * 100);
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

  const nonZero = Array.from(totals, ([currency, cents]) => ({
    currency,
    cents
  })).filter((value) => value.cents > 0);

  if (!nonZero.length) {
    return "No value set";
  }

  if (nonZero.length === 1) {
    return formatMoney(nonZero[0].cents, nonZero[0].currency, {
      compact: true
    });
  }

  return nonZero
    .slice(0, 2)
    .map((value) =>
      formatMoney(value.cents, value.currency, { compact: true })
    )
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
