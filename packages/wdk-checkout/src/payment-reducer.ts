/**
 * Pure, React-free payment state for the React adapter.
 *
 * Kept in its own module (no `react` import) so the transition logic is unit-
 * testable in a plain Node environment without pulling in React. `useWdkPayment`
 * (react.tsx) drives this reducer with useReducer.
 */

import type { PaymentStatus } from './types.js'
import { CheckoutError, canTransition } from './errors.js'

export interface PaymentState {
  readonly status: PaymentStatus
  readonly error: CheckoutError | null
  readonly txHash: string | null
}

export const INITIAL_PAYMENT_STATE: PaymentState = {
  status: 'idle',
  error: null,
  txHash: null,
}

export type PaymentAction =
  | { type: 'status'; status: PaymentStatus }
  | { type: 'submitted'; txHash: string }
  | { type: 'fail'; error: CheckoutError }
  | { type: 'reset' }

/**
 * Pure reducer. `status` actions are validated against the PAYMENT_TRANSITIONS
 * machine (illegal jumps are ignored), so a consumer driving this can't push the
 * UI into an impossible state. `submitted` records the tx hash and moves to the
 * `submitted` status; `fail` records a typed error and moves to `failed`.
 */
export function paymentReducer (state: PaymentState, action: PaymentAction): PaymentState {
  switch (action.type) {
    case 'status':
      if (action.status === state.status) return state
      if (!canTransition(state.status, action.status)) return state
      return { ...state, status: action.status, error: action.status === 'failed' ? state.error : null }
    case 'submitted':
      return { ...state, txHash: action.txHash, status: canTransition(state.status, 'submitted') ? 'submitted' : state.status }
    case 'fail':
      return { ...state, status: 'failed', error: action.error }
    case 'reset':
      return INITIAL_PAYMENT_STATE
  }
}
