/**
 * @wdk-starter/wdk-checkout/react — optional React / React Native adapter.
 *
 * A thin layer over the framework-free core so React apps get a drop-in
 * component AND a headless hook, matching the ergonomics of an in-app SDK:
 *
 *   import { WdkCheckout, useWdkPayment } from '@wdk-starter/wdk-checkout/react'
 *
 * `react` is an OPTIONAL peer dependency — importing the package root
 * (`@wdk-starter/wdk-checkout`) never pulls in React. Only this subpath does.
 *
 * - <WdkCheckout config={...}/> mounts the existing vanilla widget into a div
 *   (one source of truth for the UI — no duplicated markup), and tears it down
 *   on unmount.
 * - useWdkPayment(config) is headless: drive your own UI from { status, error,
 *   txHash, pay, confirmByHash, reset }. Errors are typed CheckoutErrors and
 *   status transitions go through the validated payment state machine.
 */

import { useCallback, useEffect, useReducer, useRef, type CSSProperties, type ReactElement } from 'react'
import type { WdkPayConfig } from './types.js'
import { mountCheckout } from './widget.js'
import { payIntent } from './usdt.js'
import { CheckoutError, toCheckoutError } from './errors.js'
import { paymentReducer, INITIAL_PAYMENT_STATE, type PaymentState } from './payment-reducer.js'

const TX_RE = /^0x[0-9a-fA-F]{64}$/

/** POST the confirm endpoint exactly like the vanilla widget does. */
async function postConfirm (config: WdkPayConfig, txHash: string, chainId?: number): Promise<'confirmed' | 'pending' | 'failed'> {
  try {
    const res = await fetch(config.endpoints.confirm, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': config.nonce },
      body: JSON.stringify({ orderKey: config.intent.orderKey, txHash, chainId: chainId ?? config.intent.chainId }),
    })
    const data = (await res.json()) as { status?: string }
    if (data.status === 'confirmed') return 'confirmed'
    if (data.status === 'failed') return 'failed'
    return 'pending'
  } catch {
    return 'pending'
  }
}

export interface UseWdkPayment extends PaymentState {
  /** Pay with the connected EVM wallet, then verify on-chain. */
  readonly pay: () => Promise<void>
  /** Verify a payment the user made elsewhere, by transaction hash. */
  readonly confirmByHash: (txHash: string) => Promise<void>
  /** Reset back to idle (clears any in-flight polling). */
  readonly reset: () => void
}

/**
 * Headless payment controller. Returns the current {@link PaymentState} plus
 * actions. Failures surface as typed {@link CheckoutError}s on `error`.
 */
export function useWdkPayment (config: WdkPayConfig): UseWdkPayment {
  const [state, dispatch] = useReducer(paymentReducer, INITIAL_PAYMENT_STATE)
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = undefined }
  }, [])

  // Clear any polling when the consumer unmounts.
  useEffect(() => stopPoll, [stopPoll])

  const runConfirm = useCallback(async (txHash: string, chainId?: number) => {
    dispatch({ type: 'status', status: 'confirming' })
    const first = await postConfirm(config, txHash, chainId)
    if (first === 'confirmed') { dispatch({ type: 'status', status: 'confirmed' }); return }
    if (first === 'failed') {
      dispatch({ type: 'fail', error: new CheckoutError('VERIFICATION_FAILED', 'We could not verify that transaction. Check the hash, amount, and recipient.') })
      return
    }
    stopPoll()
    pollRef.current = setInterval(() => {
      void postConfirm(config, txHash, chainId).then((s) => {
        if (s === 'confirmed') { stopPoll(); dispatch({ type: 'status', status: 'confirmed' }) } else if (s === 'failed') { stopPoll(); dispatch({ type: 'fail', error: new CheckoutError('VERIFICATION_FAILED', 'Verification failed.') }) }
      })
    }, 5000)
  }, [config, stopPoll])

  const pay = useCallback(async () => {
    try {
      dispatch({ type: 'reset' })
      dispatch({ type: 'status', status: 'connecting' })
      const { hash, chainId } = await payIntent(config.intent)
      dispatch({ type: 'submitted', txHash: hash })
      await runConfirm(hash, chainId)
    } catch (e) {
      dispatch({ type: 'fail', error: toCheckoutError(e) })
    }
  }, [config, runConfirm])

  const confirmByHash = useCallback(async (txHash: string) => {
    const hash = txHash.trim()
    if (!TX_RE.test(hash)) {
      dispatch({ type: 'fail', error: new CheckoutError('INVALID_TX_HASH', 'Enter a valid transaction hash (0x + 64 hex characters).') })
      return
    }
    await runConfirm(hash)
  }, [runConfirm])

  const reset = useCallback(() => { stopPoll(); dispatch({ type: 'reset' }) }, [stopPoll])

  return { ...state, pay, confirmByHash, reset }
}

export interface WdkCheckoutProps {
  /** The same config you'd pass to the vanilla `mountCheckout`. */
  readonly config: WdkPayConfig
  readonly className?: string
  readonly style?: CSSProperties
}

/**
 * Drop-in React component. Mounts the framework-free checkout widget into a
 * container `div` and tears it down on unmount — the UI is the exact same
 * widget the WooCommerce gateway ships, so there's a single source of truth.
 */
export function WdkCheckout ({ config, className, style }: WdkCheckoutProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return mountCheckout(el, config)
  }, [config])
  return <div ref={ref} className={className} style={style} />
}

export { CheckoutError, isCheckoutError, type CheckoutErrorCode } from './errors.js'
export type { PaymentState } from './payment-reducer.js'
