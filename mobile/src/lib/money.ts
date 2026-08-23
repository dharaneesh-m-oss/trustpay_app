/**
 * Money formatting.
 *
 * The API sends amounts as strings ("15000.10") precisely so JavaScript's
 * number type never touches them — 0.1 + 0.2 is not 0.3 in IEEE 754, and a
 * payments app that rounds a paisa away has a bug people can see. Everything
 * here treats an amount as a string and formats it for display only.
 */

const SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
};

export function symbolFor(currency = 'INR'): string {
  return SYMBOLS[currency] ?? `${currency} `;
}

/** Split "15000.10" into ["15,000", "10"] so the paise can be de-emphasised. */
export function splitAmount(amount: string): [string, string] {
  const negative = amount.trim().startsWith('-');
  const cleaned = amount.replace('-', '').trim();
  const [whole = '0', fraction = '00'] = cleaned.split('.');

  // Indian digit grouping: 15,00,000 rather than 1,500,000. This is the format
  // the audience actually reads amounts in.
  const grouped = groupIndian(whole);
  return [negative ? `-${grouped}` : grouped, fraction.padEnd(2, '0').slice(0, 2)];
}

function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

/** "₹15,000.10" */
export function formatMoney(amount: string | undefined, currency = 'INR'): string {
  if (amount === undefined || amount === null) return `${symbolFor(currency)}0.00`;
  const [whole, fraction] = splitAmount(String(amount));
  return `${symbolFor(currency)}${whole}.${fraction}`;
}

/** "+₹500.00" / "−₹500.00" — the sign a statement row needs. */
export function formatSigned(amount: string, currency = 'INR'): string {
  const value = String(amount);
  const isNegative = value.trim().startsWith('-');
  const formatted = formatMoney(value.replace('-', ''), currency);
  return `${isNegative ? '−' : '+'}${formatted}`;
}

/** Compact form for tight spaces: ₹1.2L, ₹15K. */
export function formatCompact(amount: string, currency = 'INR'): string {
  const value = Number(String(amount).replace(/,/g, ''));
  if (!Number.isFinite(value)) return formatMoney(amount, currency);
  const symbol = symbolFor(currency);
  if (value >= 10_000_000) return `${symbol}${(value / 10_000_000).toFixed(1)}Cr`;
  if (value >= 100_000) return `${symbol}${(value / 100_000).toFixed(1)}L`;
  if (value >= 1_000) return `${symbol}${(value / 1_000).toFixed(1)}K`;
  return formatMoney(amount, currency);
}

/** Add two decimal strings without going through a float. */
export function addAmounts(a: string, b: string): string {
  const toPaise = (value: string) => {
    const [whole = '0', fraction = '00'] = String(value).replace('-', '').split('.');
    const sign = String(value).trim().startsWith('-') ? -1 : 1;
    return sign * (Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2)));
  };
  const total = toPaise(a) + toPaise(b);
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
