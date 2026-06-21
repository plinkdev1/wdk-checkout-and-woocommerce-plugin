/**
 * wdk-payment-verifier — server-side on-chain confirmation of self-custodial
 * WDK Pay payments (the Node/headless counterpart to the WooCommerce PHP verifier).
 */
export { PaymentVerifier, matchTransfer, TRANSFER_TOPIC } from './verifier.js'
export type {
  VerifierIntent, PaymentStatus, PaymentConfirmation,
  EvmLog, EvmReceipt, EvmReadProvider,
  PaymentVerifierOptions, WatchOptions
} from './verifier.js'
