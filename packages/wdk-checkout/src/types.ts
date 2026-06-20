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
}

/** The full config object the merchant page exposes as `window.WDK_PAY`. */
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
}

/** Minimal EIP-1193 provider shape (e.g. `window.ethereum`). */
export interface EthereumProvider {
  request (args: { method: string, params?: unknown[] | object }): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
}

export type PaymentStatus = 'idle' | 'connecting' | 'awaiting-signature' | 'submitted' | 'confirming' | 'confirmed' | 'failed'
