/**
 * One-tag auto-mount config resolution (Phase 5 item 19). The DOM scan is a thin
 * wrapper; the precedence logic lives in the pure resolveAutoConfig.
 */
import { describe, it, expect } from 'vitest'
import { resolveAutoConfig } from './auto.js'

const intent = { orderId: 1 }

describe('resolveAutoConfig', () => {
  it('parses an inline data-config JSON', () => {
    const cfg = resolveAutoConfig({ config: JSON.stringify({ intent, nonce: 'n' }) }, {})
    expect(cfg).toEqual({ intent, nonce: 'n' })
  })

  it('reads a named page global via data-config-var', () => {
    const globals = { MY_CHECKOUT: { intent, nonce: 'g' } }
    expect(resolveAutoConfig({ configVar: 'MY_CHECKOUT' }, globals)).toEqual({ intent, nonce: 'g' })
  })

  it('falls back to window.WDK_PAY (the WooCommerce path)', () => {
    const globals = { WDK_PAY: { intent, nonce: 'w' } }
    expect(resolveAutoConfig({}, globals)).toEqual({ intent, nonce: 'w' })
  })

  it('precedence: inline config wins over a var and the default', () => {
    const globals = { MY: { intent, nonce: 'var' }, WDK_PAY: { intent, nonce: 'default' } }
    const cfg = resolveAutoConfig({ config: JSON.stringify({ intent, nonce: 'inline' }), configVar: 'MY' }, globals)
    expect((cfg as { nonce: string }).nonce).toBe('inline')
  })

  it('returns null for malformed JSON or a missing global', () => {
    expect(resolveAutoConfig({ config: '{not json' }, {})).toBeNull()
    expect(resolveAutoConfig({ configVar: 'NOPE' }, {})).toBeNull()
    expect(resolveAutoConfig({}, {})).toBeNull()
  })
})
