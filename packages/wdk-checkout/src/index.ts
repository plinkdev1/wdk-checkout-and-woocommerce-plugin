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
export type { PaymentIntent, WdkPayConfig, EthereumProvider, PaymentStatus, CheckoutTheme } from './types.js'
export { DEFAULT_CHECKOUT_THEME } from './types.js'
