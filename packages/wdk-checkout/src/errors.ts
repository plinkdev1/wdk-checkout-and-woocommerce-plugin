/**
 * Typed errors + the payment state machine for @wdk-starter/wdk-checkout.
 *
 * The string `PaymentStatus` is ideal for the widget's own UI, but HEADLESS
 * consumers (the React adapter, server integrations, custom UIs) need to branch
 * on the failure REASON programmatically — without brittle message string-
 * matching. `CheckoutError` carries a stable `code` for exactly that, and
 * `PAYMENT_TRANSITIONS` documents the legal status flow.
 */

import type { PaymentStatus } from './types.js'

/** Stable, machine-branchable failure reasons. */
export type CheckoutErrorCode =
  | 'NO_WALLET'            // no injected EVM provider available
  | 'WALLET_REJECTED'      // user rejected the connection or signature (EIP-1193 4001)
  | 'WRONG_CHAIN'          // wallet on the wrong chain and the switch failed/was declined
  | 'INSUFFICIENT_FUNDS'   // not enough token/gas to send
  | 'TX_FAILED'            // transaction reverted or failed to broadcast
  | 'INVALID_TX_HASH'      // manual hash entry wasn't a 0x + 64-hex tx hash
  | 'VERIFICATION_FAILED'  // backend reported the payment as failed
  | 'EXPIRED'              // the payment window elapsed
  | 'NETWORK_ERROR'        // fetch/RPC transport error
  | 'NOT_CONFIGURED'       // a required option (e.g. the optional `ethers` peer) is missing
  | 'UNKNOWN'

/** Error carrying a stable {@link CheckoutErrorCode}. */
export class CheckoutError extends Error {
  readonly code: CheckoutErrorCode
  constructor (code: CheckoutErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions)
    this.name = 'CheckoutError'
    this.code = code
  }
}

/** Type guard — true for a CheckoutError (cross-realm safe via the name check). */
export function isCheckoutError (e: unknown): e is CheckoutError {
  return e instanceof CheckoutError ||
    (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'CheckoutError' &&
     typeof (e as { code?: unknown }).code === 'string')
}

/**
 * Normalize any thrown value into a {@link CheckoutError}, mapping the common
 * EIP-1193 / ethers error shapes to stable codes. `fallback` is the code used
 * when the shape isn't recognized (pass the one that fits the call site).
 */
export function toCheckoutError (err: unknown, fallback: CheckoutErrorCode = 'UNKNOWN'): CheckoutError {
  if (isCheckoutError(err)) return err
  const e = (err ?? {}) as { code?: unknown, message?: unknown, shortMessage?: unknown }
  const msg = typeof e.shortMessage === 'string' ? e.shortMessage
    : typeof e.message === 'string' ? e.message
      : String(err)
  // EIP-1193 user-rejected is 4001; ethers v6 surfaces 'ACTION_REJECTED'.
  if (e.code === 4001 || e.code === 'ACTION_REJECTED') {
    return new CheckoutError('WALLET_REJECTED', 'You rejected the request in your wallet.', { cause: err })
  }
  if (e.code === 'INSUFFICIENT_FUNDS') {
    return new CheckoutError('INSUFFICIENT_FUNDS', 'Insufficient funds to complete the payment.', { cause: err })
  }
  if (e.code === 'CALL_EXCEPTION' || e.code === 'TRANSACTION_REPLACED' || e.code === 'NONCE_EXPIRED') {
    return new CheckoutError('TX_FAILED', msg, { cause: err })
  }
  return new CheckoutError(fallback, msg, { cause: err })
}

/**
 * Legal {@link PaymentStatus} transitions. The widget drives this flow:
 *   idle ─▶ connecting ─▶ awaiting-signature ─▶ submitted ─▶ confirming ─▶ confirmed
 *   idle ─▶ confirming (manual tx-hash path)
 *   any active step ─▶ failed; failed ─▶ retry (connecting | confirming)
 * Exported so consumers can validate/visualize the machine instead of guessing.
 */
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  idle: ['connecting', 'confirming', 'failed'],
  connecting: ['awaiting-signature', 'failed'],
  'awaiting-signature': ['submitted', 'failed'],
  submitted: ['confirming', 'confirmed', 'failed'],
  confirming: ['confirmed', 'failed'],
  confirmed: [],
  failed: ['connecting', 'confirming'],
}

/** True if `to` is a legal next status from `from`. */
export function canTransition (from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to)
}
