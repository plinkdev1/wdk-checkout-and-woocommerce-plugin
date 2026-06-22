import { describe, it, expect } from 'vitest'
import {
  CheckoutError, isCheckoutError, toCheckoutError,
  PAYMENT_TRANSITIONS, canTransition, type CheckoutErrorCode,
} from './errors.js'
import type { PaymentStatus } from './types.js'

describe('CheckoutError', () => {
  it('carries a stable code and message', () => {
    const e = new CheckoutError('NO_WALLET', 'no wallet')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('CheckoutError')
    expect(e.code).toBe('NO_WALLET')
    expect(e.message).toBe('no wallet')
  })

  it('isCheckoutError recognizes its own instances and rejects plain errors', () => {
    expect(isCheckoutError(new CheckoutError('TX_FAILED', 'x'))).toBe(true)
    expect(isCheckoutError(new Error('x'))).toBe(false)
    expect(isCheckoutError({ name: 'CheckoutError', code: 'EXPIRED' })).toBe(true) // cross-realm shape
    expect(isCheckoutError(null)).toBe(false)
  })
})

describe('toCheckoutError', () => {
  it('returns an existing CheckoutError unchanged', () => {
    const orig = new CheckoutError('EXPIRED', 'gone')
    expect(toCheckoutError(orig)).toBe(orig)
  })

  it('maps EIP-1193 user-rejected (4001) → WALLET_REJECTED', () => {
    expect(toCheckoutError({ code: 4001, message: 'User rejected' }).code).toBe('WALLET_REJECTED')
  })

  it("maps ethers 'ACTION_REJECTED' → WALLET_REJECTED", () => {
    expect(toCheckoutError({ code: 'ACTION_REJECTED' }).code).toBe('WALLET_REJECTED')
  })

  it("maps 'INSUFFICIENT_FUNDS' and reverts to the right codes", () => {
    expect(toCheckoutError({ code: 'INSUFFICIENT_FUNDS' }).code).toBe('INSUFFICIENT_FUNDS')
    expect(toCheckoutError({ code: 'CALL_EXCEPTION', shortMessage: 'reverted' }).code).toBe('TX_FAILED')
  })

  it('prefers shortMessage, falls back to message, then String()', () => {
    expect(toCheckoutError({ shortMessage: 'short', message: 'long' }).message).toBe('short')
    expect(toCheckoutError({ message: 'long' }, 'TX_FAILED').message).toBe('long')
    expect(toCheckoutError('boom', 'NETWORK_ERROR').message).toBe('boom')
  })

  it('uses the provided fallback code for unrecognized shapes', () => {
    expect(toCheckoutError({}, 'NETWORK_ERROR').code).toBe('NETWORK_ERROR')
    expect(toCheckoutError(undefined).code).toBe('UNKNOWN')
  })
})

describe('payment state machine', () => {
  it('every status has a (possibly empty) transition list', () => {
    const statuses: PaymentStatus[] = ['idle', 'connecting', 'awaiting-signature', 'submitted', 'confirming', 'confirmed', 'failed']
    for (const s of statuses) expect(Array.isArray(PAYMENT_TRANSITIONS[s])).toBe(true)
  })

  it('encodes the happy path idle → … → confirmed', () => {
    expect(canTransition('idle', 'connecting')).toBe(true)
    expect(canTransition('connecting', 'awaiting-signature')).toBe(true)
    expect(canTransition('awaiting-signature', 'submitted')).toBe(true)
    expect(canTransition('submitted', 'confirming')).toBe(true)
    expect(canTransition('confirming', 'confirmed')).toBe(true)
  })

  it('allows the manual tx-hash path (idle → confirming) and retry from failed', () => {
    expect(canTransition('idle', 'confirming')).toBe(true)
    expect(canTransition('failed', 'connecting')).toBe(true)
    expect(canTransition('failed', 'confirming')).toBe(true)
  })

  it('treats confirmed as terminal and rejects illegal jumps', () => {
    expect(PAYMENT_TRANSITIONS.confirmed).toHaveLength(0)
    expect(canTransition('confirmed', 'idle')).toBe(false)
    expect(canTransition('idle', 'confirmed')).toBe(false)
    expect(canTransition('connecting', 'confirmed')).toBe(false)
  })

  it('every code in the union is a non-empty string (sanity)', () => {
    const codes: CheckoutErrorCode[] = ['NO_WALLET', 'WALLET_REJECTED', 'WRONG_CHAIN', 'INSUFFICIENT_FUNDS', 'TX_FAILED', 'INVALID_TX_HASH', 'VERIFICATION_FAILED', 'EXPIRED', 'NETWORK_ERROR', 'NOT_CONFIGURED', 'UNKNOWN']
    for (const c of codes) expect(new CheckoutError(c, 'm').code).toBe(c)
  })
})
