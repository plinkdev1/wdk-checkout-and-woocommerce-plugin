import { describe, it, expect } from 'vitest'
import { paymentReducer, INITIAL_PAYMENT_STATE } from './payment-reducer.js'
import { CheckoutError } from './errors.js'

describe('paymentReducer', () => {
  it('starts idle with no error/txHash', () => {
    expect(INITIAL_PAYMENT_STATE).toEqual({ status: 'idle', error: null, txHash: null })
  })

  it('applies a legal status transition', () => {
    const s = paymentReducer(INITIAL_PAYMENT_STATE, { type: 'status', status: 'connecting' })
    expect(s.status).toBe('connecting')
  })

  it('ignores an illegal status transition (machine-guarded)', () => {
    const s = paymentReducer(INITIAL_PAYMENT_STATE, { type: 'status', status: 'confirmed' })
    expect(s.status).toBe('idle') // idle → confirmed is not allowed
    expect(s).toBe(INITIAL_PAYMENT_STATE) // unchanged reference
  })

  it('no-ops a transition to the same status', () => {
    const s = paymentReducer(INITIAL_PAYMENT_STATE, { type: 'status', status: 'idle' })
    expect(s).toBe(INITIAL_PAYMENT_STATE)
  })

  it('records the tx hash and moves to submitted', () => {
    const connecting = paymentReducer(INITIAL_PAYMENT_STATE, { type: 'status', status: 'connecting' })
    const awaiting = paymentReducer(connecting, { type: 'status', status: 'awaiting-signature' })
    const s = paymentReducer(awaiting, { type: 'submitted', txHash: '0xabc' })
    expect(s.status).toBe('submitted')
    expect(s.txHash).toBe('0xabc')
  })

  it('fail records a typed error and moves to failed', () => {
    const err = new CheckoutError('WALLET_REJECTED', 'nope')
    const s = paymentReducer({ status: 'connecting', error: null, txHash: null }, { type: 'fail', error: err })
    expect(s.status).toBe('failed')
    expect(s.error).toBe(err)
  })

  it('clears the error when leaving failed via a legal retry transition', () => {
    const failed = { status: 'failed' as const, error: new CheckoutError('TX_FAILED', 'x'), txHash: '0x1' }
    const s = paymentReducer(failed, { type: 'status', status: 'connecting' })
    expect(s.status).toBe('connecting')
    expect(s.error).toBeNull()
  })

  it('reset returns the initial state', () => {
    const dirty = { status: 'failed' as const, error: new CheckoutError('UNKNOWN', 'x'), txHash: '0x9' }
    expect(paymentReducer(dirty, { type: 'reset' })).toEqual(INITIAL_PAYMENT_STATE)
  })
})
