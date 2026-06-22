/**
 * wdk-checkout — headless WDK checkout SDK.
 *
 * Self-custodial USDt payments for ecommerce. Used by the WooCommerce "WDK Pay"
 * gateway and usable standalone in any storefront.
 */
export { mountCheckout } from './widget.js'
export { payIntent, connectWallet, ensureChain, ERC20_ABI } from './usdt.js'
export { qrDataUrl } from './qr.js'
export { getEthers, getInjectedProvider, toHexChainId } from './eth.js'
export {
  CheckoutError, isCheckoutError, toCheckoutError,
  PAYMENT_TRANSITIONS, canTransition,
} from './errors.js'
export type { CheckoutErrorCode } from './errors.js'
export type { PaymentIntent, WdkPayConfig, EthereumProvider, PaymentStatus, CheckoutTheme } from './types.js'
export { DEFAULT_CHECKOUT_THEME } from './types.js'
export {
  formatFiat, formatTokenAmount, fiatToTokenBase,
  staticRate, endpointRate, quoteTokenBase, fiatDisplayLine
} from './pricing.js'
export type { FiatPrice, RateSource, FiatDisplayIntent } from './pricing.js'
