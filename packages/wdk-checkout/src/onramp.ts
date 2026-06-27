/**
 * Fiat on-ramp at checkout (Phase 4 item 9) — let a shopper without crypto buy
 * and pay in one flow. This module builds the "buy crypto" URL; the widget shows
 * a **Buy with card ↗** link when `WdkPayConfig.onramp` is set.
 *
 * Pluggable: MoonPay by default (`@tetherto/wdk-protocol-fiat-moonpay` shape) or
 * any provider via `baseUrl`. **Production note:** MoonPay requires the URL to be
 * **signed** with your secret key server-side; pass the signed URL through
 * `signUrl`, or wire your backend's signer. The publishable key alone works for
 * the sandbox. Nothing here holds a secret.
 */

export interface OnrampConfig {
  /** Provider hint (informational; the URL shape is driven by `baseUrl`). */
  readonly provider?: 'moonpay' | 'generic'
  /** Buy-widget base URL. Defaults to MoonPay (`https://buy.moonpay.com`). */
  readonly baseUrl?: string
  /** Publishable API key (e.g. MoonPay `pk_live_…` / `pk_test_…`). */
  readonly apiKey?: string
  /** Crypto to buy, e.g. `usdt`. Defaults to the order token's symbol. */
  readonly currencyCode?: string
  /** Extra query params merged onto the URL (theme, redirectURL, …). */
  readonly params?: Readonly<Record<string, string>>
  /**
   * Optional transform for the built URL — e.g. route it through your backend's
   * MoonPay signer (`https://yourstore/moonpay/sign?url=…`). Applied last.
   */
  readonly signUrl?: (url: string) => string
}

export interface OnrampOptions {
  /** Crypto currency code to buy (overrides the config default). */
  readonly currencyCode?: string
  /** Deliver-to wallet address, if the shopper has connected one. */
  readonly walletAddress?: string
  /** Pre-fill the fiat amount (the order total). */
  readonly fiatAmount?: string | number
  /** Pre-fill the fiat currency (e.g. `USD`). */
  readonly fiatCurrency?: string
}

const DEFAULT_MOONPAY = 'https://buy.moonpay.com'

/**
 * Build a fiat-on-ramp "buy crypto" URL pre-filled for the order. Pure: no
 * network, no secrets. Run the result through `cfg.signUrl` for production
 * MoonPay (server-signed) if provided.
 */
export function buildOnrampUrl (cfg: OnrampConfig, opts: OnrampOptions = {}): string {
  const base = (cfg.baseUrl ?? DEFAULT_MOONPAY).replace(/\/+$/, '')
  const q = new URLSearchParams()

  if (cfg.apiKey) q.set('apiKey', cfg.apiKey)

  const currency = opts.currencyCode ?? cfg.currencyCode
  if (currency) q.set('currencyCode', currency.toLowerCase())

  if (opts.walletAddress) q.set('walletAddress', opts.walletAddress)
  if (opts.fiatAmount !== undefined && opts.fiatAmount !== null && `${opts.fiatAmount}` !== '') {
    q.set('baseCurrencyAmount', String(opts.fiatAmount))
  }
  if (opts.fiatCurrency) q.set('baseCurrencyCode', opts.fiatCurrency.toLowerCase())

  for (const [k, v] of Object.entries(cfg.params ?? {})) q.set(k, v)

  const qs = q.toString()
  const url = qs ? `${base}?${qs}` : base
  return cfg.signUrl ? cfg.signUrl(url) : url
}
