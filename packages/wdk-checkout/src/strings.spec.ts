/**
 * Localization — string overrides / locale packs (Phase 5 item 17). Locks the
 * pure resolver; the widget threads the resolved strings into every label.
 */
import { describe, it, expect } from 'vitest'
import { resolveCheckoutStrings, DEFAULT_CHECKOUT_STRINGS } from './types.js'

describe('resolveCheckoutStrings', () => {
  it('returns the English defaults with no override', () => {
    expect(resolveCheckoutStrings()).toEqual(DEFAULT_CHECKOUT_STRINGS)
    expect(resolveCheckoutStrings().payWithWallet).toBe('Pay with wallet')
  })

  it('layers a partial override (a locale pack) over the defaults', () => {
    const es = resolveCheckoutStrings({
      payWithWallet: 'Pagar con cartera',
      payManually: 'Pagar manualmente',
      pay: 'Pagar',
      securedBy: 'Asegurado por WDK · autocustodia · verificado on-chain',
    })
    expect(es.payWithWallet).toBe('Pagar con cartera')
    expect(es.pay).toBe('Pagar')
    // untouched keys keep the English default
    expect(es.confirmPayment).toBe(DEFAULT_CHECKOUT_STRINGS.confirmPayment)
  })

  it('covers every visible string key (no gaps in the contract)', () => {
    // A locale pack author relies on this surface being complete.
    const keys = Object.keys(DEFAULT_CHECKOUT_STRINGS)
    expect(keys).toContain('paymentWindow')
    expect(keys).toContain('confirmedRedirecting')
    expect(keys).toContain('invalidHash')
    expect(keys.length).toBeGreaterThanOrEqual(25)
    // none of the defaults are empty.
    expect(Object.values(DEFAULT_CHECKOUT_STRINGS).every((v) => typeof v === 'string' && v.length > 0)).toBe(true)
  })
})
