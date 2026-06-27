/**
 * The payment intent the merchant back-end produces for an order. Mirrors the
 * `WDK_PAY.intent` object the WooCommerce plugin localizes onto the page.
 */
export interface PaymentIntent {
  /** WooCommerce order id. */
  readonly orderId: number
  /** WooCommerce order key — acts as the payment capability token. */
  readonly orderKey: string
  /** Human amount, e.g. "19.99". */
  readonly amount: string
  /** Amount in token base units (decimal string), e.g. "19990000" for 19.99 USDt. */
  readonly amountBase: string
  /** Token decimals (USDt = 6). */
  readonly decimals: number
  /** USDt ERC-20 contract address on the chosen chain. */
  readonly tokenAddress: string
  /** Display symbol, e.g. "USDt". */
  readonly tokenSymbol: string
  /** Numeric EVM chain id (1, 137, 42161, …). */
  readonly chainId: number
  /** Human chain name, e.g. "Ethereum". */
  readonly chainName: string
  /** Chain key, e.g. "ethereum". */
  readonly chainKey: string
  /** Merchant receiving address. */
  readonly receivingAddress: string
  /** Unique 32-byte payment reference derived from the order. */
  readonly reference: string
  /** Current order payment status. */
  readonly status: 'pending' | 'confirmed'
  /** Unix seconds after which the payment window closes. */
  readonly expiresAt: number
  /**
   * Optional store-currency total for display, e.g. "19.99". When present with
   * {@link currency}, the widget shows the familiar fiat price alongside the
   * on-chain token amount. The on-chain amount remains {@link amountBase}.
   */
  readonly displayTotal?: string
  /** Optional ISO-4217 store currency for {@link displayTotal}, e.g. "USD". */
  readonly currency?: string
}

/** The full config object the merchant page exposes as `window.WDK_PAY`. */
/**
 * Color/typography palette for the checkout widget. Every key is optional —
 * unspecified keys fall back to {@link DEFAULT_CHECKOUT_THEME}. Pass a partial
 * via `WdkPayConfig.theme` to match the merchant's storefront.
 */
export interface CheckoutTheme {
  /** Dark card / surface background. */
  surface: string
  /** Text on the dark surface. */
  onSurface: string
  /** Primary text color. */
  text: string
  /** Muted / secondary text. */
  textMuted: string
  /** Faint text (footer, field labels). */
  textFaint: string
  /** Accent / primary-button color (brand). */
  accent: string
  /** Text on the accent button. */
  accentText: string
  /** Input + control border color. */
  border: string
  /** In-progress status color. */
  info: string
  /** Success status color. */
  success: string
  /** Error status color. */
  error: string
  /** Global corner radius (e.g. "14px"); the per-element radii below fall back to it. */
  radius: string
  /** Card/surface corner radius. Falls back to {@link radius}. */
  cardRadius?: string
  /** Button corner radius — independently roundable (square / rounded / pill). Falls back to {@link radius}. */
  buttonRadius?: string
  /** Input/control corner radius. Falls back to {@link radius}. */
  inputRadius?: string
  /** Primary-button style: filled accent (`solid`, default), `outline`, or `soft` (tinted accent). */
  buttonStyle?: 'solid' | 'outline' | 'soft'
  /** Font-family stack (body text). */
  fontFamily: string
  /** Optional heading/display font stack (brand name + amount). Falls back to fontFamily. */
  headingFontFamily?: string
  /**
   * Optional web-font stylesheet URL to actually *load* the brand font (e.g. a
   * Google Fonts `https://fonts.googleapis.com/css2?family=…` href, or any
   * `@font-face` CSS). Injected as a `<link rel="stylesheet">` scoped to the
   * widget; without it `fontFamily` only requests already-installed fonts.
   */
  fontUrl?: string
}

/**
 * User-facing widget strings. Every key is optional via
 * `WdkPayConfig.strings` — unspecified keys fall back to
 * {@link DEFAULT_CHECKOUT_STRINGS} (English). Ship locale packs by passing a
 * full map. Amount/symbol/chain are interpolated by the widget, not stored here.
 */
export interface CheckoutStrings {
  /** Tab: pay with a connected wallet. */
  payWithWallet: string
  /** Tab: pay manually (QR + confirm by hash). */
  payManually: string
  /** Primary pay-button prefix (`{prefix} 19.99 USDt`). */
  pay: string
  /** Wallet-tab hint under the pay button. */
  walletHint: string
  /** Manual: "Send exactly" label. */
  sendExactly: string
  /** Manual: "To address" label. */
  toAddress: string
  /** Manual: paste-hash prompt. */
  alreadyPaid: string
  /** Manual: confirm-by-hash button. */
  confirmPayment: string
  /** Footer line. */
  securedBy: string
  /** Countdown prefix (`{prefix} 04:59`). */
  paymentWindow: string
  /** Countdown when the window has elapsed. */
  paymentWindowExpired: string
  /** Flow message: connecting the wallet. */
  connectingWallet: string
  /** Flow message: awaiting the in-wallet signature. */
  confirmInWalletLong: string
  /** Flow message: tx submitted, awaiting confirmation. */
  submittedWaiting: string
  /** Flow message: generic failure fallback. */
  paymentFailed: string
  /** Status pill: connecting. */
  statusConnecting: string
  /** Status pill: awaiting signature. */
  statusAwaitingSignature: string
  /** Status pill: submitted. */
  statusSubmitted: string
  /** Status pill: verifying on-chain. */
  statusConfirming: string
  /** Status pill: confirmed. */
  statusConfirmed: string
  /** Status pill: failed. */
  statusFailed: string
  /** Terminal message shown before redirecting. */
  confirmedRedirecting: string
  /** Flow message: verifying the pasted/submitted hash on-chain. */
  verifyingOnChain: string
  /** Flow message: verification of a hash did not match. */
  couldNotVerify: string
  /** Flow message: short verification-failed (poll path). */
  verificationFailed: string
  /** Validation: the pasted hash is malformed. */
  invalidHash: string
  /** Accessible label for the transaction-hash input. */
  hashInputAria: string
  /** Fiat on-ramp link ("Don't have crypto? Buy with card"). */
  buyWithCard: string
}

/** Default (English) widget strings. Override any subset via `WdkPayConfig.strings`. */
export const DEFAULT_CHECKOUT_STRINGS: CheckoutStrings = {
  payWithWallet: 'Pay with wallet',
  payManually: 'Pay manually',
  pay: 'Pay',
  walletHint: 'Pay directly from a WDK-powered or any EVM wallet. You stay in custody of your funds the entire time.',
  sendExactly: 'Send exactly',
  toAddress: 'To address',
  alreadyPaid: 'Already paid from another wallet? Paste your transaction hash to confirm:',
  confirmPayment: 'Confirm payment',
  securedBy: 'Secured by WDK · self-custodial · on-chain verified',
  paymentWindow: 'Payment window:',
  paymentWindowExpired: 'Payment window expired — refresh to retry.',
  connectingWallet: 'Connecting your wallet…',
  confirmInWalletLong: 'Confirm the payment in your wallet…',
  submittedWaiting: 'Payment submitted. Waiting for confirmation…',
  paymentFailed: 'Payment failed.',
  statusConnecting: 'Connecting…',
  statusAwaitingSignature: 'Confirm in your wallet…',
  statusSubmitted: 'Submitted…',
  statusConfirming: 'Verifying…',
  statusConfirmed: 'Payment confirmed ✓',
  statusFailed: 'Payment failed',
  confirmedRedirecting: 'Payment confirmed ✓ — redirecting…',
  verifyingOnChain: 'Verifying your payment on-chain…',
  couldNotVerify: 'We could not verify that transaction. Check the hash, amount, and recipient and try again.',
  verificationFailed: 'Verification failed.',
  invalidHash: 'Enter a valid transaction hash (0x…64 hex chars).',
  hashInputAria: 'Transaction hash',
  buyWithCard: "Don't have crypto? Buy with card ↗",
}

/** Merge a partial string override over the English defaults. */
export function resolveCheckoutStrings (partial?: Partial<CheckoutStrings>): CheckoutStrings {
  return { ...DEFAULT_CHECKOUT_STRINGS, ...(partial ?? {}) }
}

/** Optional merchant brand shown atop the widget (logo + store name) — white-label. */
export interface CheckoutBrand {
  /** Store / brand name shown next to the logo. */
  readonly name?: string
  /** Logo image URL (rendered ~28px tall). */
  readonly logoUrl?: string
  /** Accessible alt text for the logo (defaults to `name`). */
  readonly logoAlt?: string
}

/** WDK default palette (warm dark surface + WDK orange accent). */
export const DEFAULT_CHECKOUT_THEME: CheckoutTheme = {
  surface: '#161312',
  onSurface: '#f7eee8',
  text: '#161312',
  textMuted: '#6b6b6b',
  textFaint: '#9a9a9a',
  accent: '#f4642f',
  accentText: '#ffffff',
  border: '#cccccc',
  info: '#1f6feb',
  success: '#16a34a',
  error: '#dc2626',
  radius: '14px',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
}

/** Dark-storefront palette — light text on dark surfaces, same WDK orange accent. */
export const DARK_CHECKOUT_THEME: CheckoutTheme = {
  surface: '#0f0b08',
  onSurface: '#f7eee8',
  text: '#f7eee8',
  textMuted: '#b9a89e',
  textFaint: '#8a7c72',
  accent: '#f4642f',
  accentText: '#1a0f08',
  border: '#2a221c',
  info: '#3b82f6',
  success: '#22c55e',
  error: '#ef4444',
  radius: '14px',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
}

/** Cool-dark palette — slate surfaces + a cyan/blue accent (no warm tones). */
export const COOL_DARK_CHECKOUT_THEME: CheckoutTheme = {
  surface: '#0d1117',
  onSurface: '#e6edf3',
  text: '#e6edf3',
  textMuted: '#8b949e',
  textFaint: '#6e7681',
  accent: '#2f81f7',
  accentText: '#ffffff',
  border: '#30363d',
  info: '#2f81f7',
  success: '#3fb950',
  error: '#f85149',
  radius: '12px',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
}

/** Institutional-light palette — clean white surfaces + a measured blue accent. */
export const INSTITUTIONAL_LIGHT_CHECKOUT_THEME: CheckoutTheme = {
  surface: '#ffffff',
  onSurface: '#0b1f33',
  text: '#0b1f33',
  textMuted: '#52606d',
  textFaint: '#7b8794',
  accent: '#1d4ed8',
  accentText: '#ffffff',
  border: '#d7dee5',
  info: '#1d4ed8',
  success: '#15803d',
  error: '#b91c1c',
  radius: '8px',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
}

/**
 * Built-in theme presets. Pick a base for your storefront, then override
 * individual tokens via `WdkPayConfig.theme`. The WDK default stays the
 * standard; everything else is opt-in customization. These names form a
 * **shared contract** with the WDK wallet UI so a preset means the same thing
 * across the suite.
 */
export const CHECKOUT_THEMES = {
  /** WDK default — orange accent, dark amount card, for a LIGHT storefront. */
  wdk: DEFAULT_CHECKOUT_THEME,
  /** For DARK storefronts — warm dark surfaces, WDK orange accent. */
  dark: DARK_CHECKOUT_THEME,
  /** Cool dark — slate surfaces, blue/cyan accent. */
  'cool-dark': COOL_DARK_CHECKOUT_THEME,
  /** Institutional light — white surfaces, measured blue accent. */
  'institutional-light': INSTITUTIONAL_LIGHT_CHECKOUT_THEME,
} as const

/** A built-in preset name. */
export type CheckoutThemeName = keyof typeof CHECKOUT_THEMES

/**
 * Resolve the effective {@link CheckoutTheme} from theming options:
 *  - an explicit `preset` name wins;
 *  - otherwise `mode` selects light/dark (`'auto'` follows `prefersDark`);
 *  - then the `theme` partial is layered on top.
 *
 * `prefersDark` is the host's `prefers-color-scheme: dark` result (the widget
 * passes `matchMedia(...)`; default `false` keeps it deterministic in tests).
 */
export function resolveCheckoutTheme (
  opts: {
    readonly preset?: CheckoutThemeName | 'auto'
    readonly mode?: 'light' | 'dark' | 'auto'
    readonly theme?: Partial<CheckoutTheme>
  } = {},
  prefersDark = false,
): CheckoutTheme {
  let base: CheckoutTheme
  if (opts.preset && opts.preset !== 'auto') {
    base = CHECKOUT_THEMES[opts.preset]
  } else {
    const mode = opts.mode ?? (opts.preset === 'auto' ? 'auto' : 'light')
    const dark = mode === 'dark' || (mode === 'auto' && prefersDark)
    base = dark ? DARK_CHECKOUT_THEME : DEFAULT_CHECKOUT_THEME
  }
  return { ...base, ...(opts.theme ?? {}) }
}

export interface WdkPayConfig {
  readonly intent: PaymentIntent
  readonly endpoints: {
    /** POST { orderKey, txHash, from?, chainId? } → { status, orderId } */
    readonly confirm: string
    /** GET → { status, txHash } */
    readonly status: string
  }
  /** WordPress REST nonce (sent as the X-WP-Nonce header). */
  readonly nonce: string
  /** Order-received URL to redirect to once confirmed. */
  readonly returnUrl: string
  /** Optional block-explorer base URL for tx links. */
  readonly explorer?: string
  /**
   * Optional base preset by name (`'wdk'`, `'dark'`, `'cool-dark'`,
   * `'institutional-light'`), or `'auto'` to follow `prefers-color-scheme`.
   * Layered under {@link theme}.
   */
  readonly preset?: CheckoutThemeName | 'auto'
  /** Optional color mode when no explicit preset: `'auto'` follows `prefers-color-scheme`. */
  readonly mode?: 'light' | 'dark' | 'auto'
  /** Optional palette override — match the widget to your storefront (layered over the preset/mode base). */
  readonly theme?: Partial<CheckoutTheme>
  /** Optional merchant brand (logo + store name) rendered atop the widget. */
  readonly brand?: CheckoutBrand
  /** Optional UI-string overrides / locale pack (layered over the English defaults). */
  readonly strings?: Partial<CheckoutStrings>
  /**
   * Optional raw CSS injected into the widget (a `<style>` scoped to the root) for
   * pixel-level control beyond the token set. Target the stable `data-wdk` hooks,
   * e.g. `[data-wdk="pay-button"]{letter-spacing:.04em}`.
   */
  readonly customCss?: string
  /**
   * Optional fiat on-ramp. When set, the widget shows a "Buy with card" link that
   * opens a buy-crypto flow (MoonPay by default) pre-filled with the order amount,
   * so a shopper without crypto can fund and pay. See `OnrampConfig`.
   */
  readonly onramp?: import('./onramp.js').OnrampConfig
}

/** Minimal EIP-1193 provider shape (e.g. `window.ethereum`). */
export interface EthereumProvider {
  request (args: { method: string, params?: unknown[] | object }): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
}

export type PaymentStatus = 'idle' | 'connecting' | 'awaiting-signature' | 'submitted' | 'confirming' | 'confirmed' | 'failed'
