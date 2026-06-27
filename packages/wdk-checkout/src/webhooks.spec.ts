/**
 * Payment-status webhooks (Phase 4 item 10) — canonical body + HMAC sign/verify.
 */
import { describe, it, expect } from 'vitest'
import { buildWebhookEvent, webhookBody, signWebhook, verifyWebhook } from './webhooks.js'

describe('buildWebhookEvent + webhookBody', () => {
  it('drops undefined fields and serializes with stable key order', () => {
    const e = buildWebhookEvent('payment.confirmed', {
      orderId: 42,
      orderKey: 'wc_k',
      status: 'confirmed',
      txHash: '0xabc',
      chainId: 1,
      amount: undefined,
      token: undefined,
      timestamp: 1700000000,
    })
    expect(e).not.toHaveProperty('amount')
    const body = webhookBody(e)
    // keys sorted alphabetically → deterministic body for signing
    expect(body).toBe('{"chainId":1,"orderId":42,"orderKey":"wc_k","status":"confirmed","timestamp":1700000000,"txHash":"0xabc","type":"payment.confirmed"}')
  })
})

describe('signWebhook / verifyWebhook', () => {
  it('round-trips a signature (sha256= prefixed hex)', async () => {
    const body = webhookBody(buildWebhookEvent('payment.confirmed', { orderId: 1, orderKey: 'k', status: 'confirmed', timestamp: 1 }))
    const sig = await signWebhook('shh', body)
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(await verifyWebhook('shh', body, sig)).toBe(true)
  })

  it('rejects a wrong secret, tampered body, or bad signature', async () => {
    const body = webhookBody(buildWebhookEvent('payment.failed', { orderId: 2, orderKey: 'k', status: 'failed', timestamp: 2 }))
    const sig = await signWebhook('right', body)
    expect(await verifyWebhook('wrong', body, sig)).toBe(false)
    expect(await verifyWebhook('right', body + ' ', sig)).toBe(false)
    expect(await verifyWebhook('right', body, 'sha256=deadbeef')).toBe(false)
  })

  it('accepts a signature without the sha256= prefix too', async () => {
    const body = webhookBody(buildWebhookEvent('payment.pending', { orderId: 3, orderKey: 'k', status: 'pending', timestamp: 3 }))
    const sig = (await signWebhook('s', body)).replace('sha256=', '')
    expect(await verifyWebhook('s', body, sig)).toBe(true)
  })
})
