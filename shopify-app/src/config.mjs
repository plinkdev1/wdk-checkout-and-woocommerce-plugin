/**
 * Environment-driven config for the WDK Pay Shopify app.
 *
 * Nothing secret is hard-coded; a merchant sets these in their environment. The
 * chain/token defaults to USDt on Ethereum, mirroring the WooCommerce gateway.
 */

export const config = {
  // ── App server ──────────────────────────────────────────────────────────
  port: Number(process.env.PORT ?? 8788),
  /** Public base URL of THIS app (used to build the buyer redirect). */
  appUrl: (process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 8788}`).replace(/\/$/, ''),

  // ── Shopify ────────────────────────────────────────────────────────────
  /** my-store.myshopify.com */
  shop: process.env.SHOPIFY_SHOP ?? '',
  /** App API secret — verifies the HMAC on payment-session / webhook posts. */
  apiSecret: process.env.SHOPIFY_API_SECRET ?? '',
  /** Payments Apps API access token (to resolve/reject sessions). */
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN ?? '',
  apiVersion: process.env.SHOPIFY_API_VERSION ?? '2024-10',

  // ── Chain / token (what the buyer pays, and what we verify) ──────────────
  rpcUrl: process.env.WDK_RPC_URL ?? '',
  token: process.env.WDK_TOKEN ?? '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDt (Ethereum)
  receiving: process.env.WDK_RECEIVING ?? '',
  chainId: Number(process.env.WDK_CHAIN_ID ?? 1),
  chainName: process.env.WDK_CHAIN_NAME ?? 'Ethereum',
  chainKey: process.env.WDK_CHAIN_KEY ?? 'ethereum',
  decimals: Number(process.env.WDK_DECIMALS ?? 6),
  tokenSymbol: process.env.WDK_TOKEN_SYMBOL ?? 'USDt',
  confirmations: Number(process.env.WDK_CONFIRMATIONS ?? 1),

  /** Path to the built checkout widget bundle to serve at /wdk-checkout.js. */
  widgetBundle: process.env.WDK_WIDGET_BUNDLE ??
    new URL('../../woocommerce-plugin/wdk-pay/assets/js/wdk-checkout.js', import.meta.url).pathname,
}

/** Throw early if the app isn't configured enough to verify a real payment. */
export function assertConfigured () {
  const missing = []
  if (!config.shop) missing.push('SHOPIFY_SHOP')
  if (!config.accessToken) missing.push('SHOPIFY_ACCESS_TOKEN')
  if (!config.rpcUrl) missing.push('WDK_RPC_URL')
  if (!config.receiving) missing.push('WDK_RECEIVING')
  if (missing.length) {
    throw new Error(`WDK Pay Shopify app is not configured. Set: ${missing.join(', ')}`)
  }
}
