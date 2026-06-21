/**
 * Fiat pricing for the checkout widget.
 *
 * The WooCommerce gateway settles in USDt and, by default, assumes the store
 * currency maps 1:1 to USDt. This module provides the building blocks to:
 *
 *   1. **Display** the familiar fiat price next to the on-chain amount
 *      (so the checkout reads like any other store checkout), and
 *   2. **Convert** a fiat-priced order into a token amount when the store
 *      currency is NOT 1:1 with the settlement token — using a price source
 *      *you* supply (CoinGecko, Chainlink, an exchange, your own feed).
 *
 * No price source is hard-coded: `RateSource` is an interface, `staticRate`
 * covers the 1:1 case, and `endpointRate` wires any JSON endpoint. All money
 * math uses exact integer/string arithmetic on base units — no float drift on
 * the amount a customer is charged.
 */

/** A fiat price: a decimal amount in an ISO-4217 currency. */
export interface FiatPrice {
  /** Decimal amount, e.g. 19.99. */
  readonly amount: number
  /** ISO 4217 currency code, e.g. "USD", "EUR". */
  readonly currency: string
}

/**
 * Format a fiat amount for display, locale-aware. Falls back to
 * `"<amount> <currency>"` if Intl or the currency code is unavailable.
 */
export function formatFiat (amount: number, currency: string, locale?: string): string {
  if (!isFinite(amount)) return `${String(amount)} ${currency}`
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

/**
 * Format a token base-unit amount (e.g. "19990000" @ 6 decimals → "19.99") as a
 * human string. Exact (BigInt) — no floating point. Trailing zeros are trimmed.
 *
 * @param base     Integer base units (decimal string or bigint).
 * @param decimals Token decimals (USDt = 6).
 * @param opts.maxFractionDigits Cap the fraction (truncates, does not round).
 * @param opts.group Insert thousands separators in the integer part.
 */
export function formatTokenAmount (
  base: string | bigint,
  decimals: number,
  opts: { maxFractionDigits?: number, group?: boolean } = {}
): string {
  const d = Math.max(0, Math.floor(decimals))
  let s = typeof base === 'bigint' ? base.toString() : String(base).trim()
  const neg = s.startsWith('-')
  if (neg) s = s.slice(1)
  if (!/^\d+$/.test(s)) throw new Error(`formatTokenAmount: invalid base-unit amount: ${String(base)}`)
  s = s.replace(/^0+(?=\d)/, '')

  const padded = s.padStart(d + 1, '0')
  const cut = padded.length - d
  let int = padded.slice(0, cut)
  let frac = d > 0 ? padded.slice(cut) : ''

  if (opts.maxFractionDigits !== undefined) frac = frac.slice(0, Math.max(0, opts.maxFractionDigits))
  frac = frac.replace(/0+$/, '')

  if (opts.group) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  const body = frac ? `${int}.${frac}` : int
  return neg && body !== '0' ? `-${body}` : body
}

/**
 * Convert a fiat amount to integer token base units at a given rate.
 *
 * `rateTokenPerFiat` is how many token units 1 unit of fiat buys (USD→USDt is
 * ~1.0). The result is rounded to the token's smallest unit via `toFixed`,
 * which is string-based and so safe for high-decimal tokens.
 *
 * @returns Base units as a decimal string (e.g. "19990000").
 */
export function fiatToTokenBase (args: {
  fiatAmount: number
  rateTokenPerFiat: number
  tokenDecimals: number
}): string {
  const { fiatAmount, rateTokenPerFiat, tokenDecimals } = args
  if (!isFinite(fiatAmount) || fiatAmount < 0) throw new Error('fiatToTokenBase: fiatAmount must be a non-negative finite number')
  if (!isFinite(rateTokenPerFiat) || rateTokenPerFiat <= 0) throw new Error('fiatToTokenBase: rateTokenPerFiat must be a positive finite number')

  const d = Math.max(0, Math.floor(tokenDecimals))
  const fixed = (fiatAmount * rateTokenPerFiat).toFixed(d) // exactly d fractional digits, rounded
  const [int, frac = ''] = fixed.split('.')
  const base = (int + frac).replace(/^0+(?=\d)/, '')
  return base === '' ? '0' : base
}

/**
 * A pluggable source of an FX rate: token units per 1 unit of fiat.
 * Implement this to price in any currency against any settlement token.
 */
export interface RateSource {
  getRate (fiatCurrency: string, tokenSymbol: string): Promise<number>
}

/** A fixed rate (use 1 for a store already denominated 1:1 with the token). */
export function staticRate (rate: number): RateSource {
  if (!isFinite(rate) || rate <= 0) throw new Error('staticRate: rate must be a positive finite number')
  return { getRate: async () => rate }
}

/**
 * A RateSource backed by a JSON endpoint. `{fiat}` / `{token}` in the URL are
 * replaced with the currency / token symbol. `fetch` is injectable for tests
 * and non-browser runtimes; `parse` extracts the numeric rate (defaults to
 * `json.rate ?? json.price`).
 */
export function endpointRate (url: string, opts: {
  fetchImpl?: typeof fetch
  headers?: Record<string, string>
  parse?: (json: unknown) => number
} = {}): RateSource {
  const f = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined)
  const parse = opts.parse ?? ((j: unknown) => {
    const o = (j ?? {}) as Record<string, unknown>
    return Number(o.rate ?? o.price)
  })
  return {
    async getRate (fiatCurrency, tokenSymbol) {
      if (typeof f !== 'function') throw new Error('endpointRate: no fetch available; pass opts.fetchImpl')
      const u = url
        .replace('{fiat}', encodeURIComponent(fiatCurrency))
        .replace('{token}', encodeURIComponent(tokenSymbol))
      const res = await f(u, opts.headers ? { headers: opts.headers } : undefined)
      if (!res.ok) throw new Error(`endpointRate: HTTP ${res.status}`)
      const rate = parse(await res.json())
      if (!isFinite(rate) || rate <= 0) throw new Error('endpointRate: response did not contain a positive rate')
      return rate
    }
  }
}

/**
 * Quote a fiat price as token base units via a RateSource. One call that a
 * merchant back-end (or the widget) uses to turn "€100.00" into the exact
 * settlement amount.
 */
export async function quoteTokenBase (args: {
  fiat: FiatPrice
  tokenSymbol: string
  tokenDecimals: number
  source: RateSource
}): Promise<{ rate: number, amountBase: string }> {
  const rate = await args.source.getRate(args.fiat.currency, args.tokenSymbol)
  return {
    rate,
    amountBase: fiatToTokenBase({ fiatAmount: args.fiat.amount, rateTokenPerFiat: rate, tokenDecimals: args.tokenDecimals })
  }
}

/** Minimal shape of the fields a fiat display reads off a payment intent. */
export interface FiatDisplayIntent {
  readonly displayTotal?: string | number
  readonly currency?: string
}

/**
 * The fiat line for the widget's amount card, or null when the intent carries
 * no fiat price (e.g. a store that prices directly in USDt).
 */
export function fiatDisplayLine (intent: FiatDisplayIntent, locale?: string): string | null {
  if (intent.displayTotal === undefined || intent.displayTotal === null || !intent.currency) return null
  const amt = typeof intent.displayTotal === 'number' ? intent.displayTotal : Number(intent.displayTotal)
  if (!isFinite(amt)) return null
  return formatFiat(amt, intent.currency, locale)
}
