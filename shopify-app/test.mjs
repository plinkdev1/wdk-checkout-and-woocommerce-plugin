/**
 * Tests for the Shopify app's request auth + Payments Apps API client.
 * (These cover the pure glue; the on-chain verify path is tested in the core.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

// Configure before importing the modules (config reads env at import time).
process.env.SHOPIFY_API_SECRET = 'test-secret'
process.env.SHOPIFY_SHOP = 'demo.myshopify.com'
process.env.SHOPIFY_ACCESS_TOKEN = 'tok'

const { verifyShopifyHmac, resolvePaymentSession, rejectPaymentSession } = await import('./src/shopify.mjs')

const sign = (body, secret) => crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')

test('verifyShopifyHmac accepts a correct signature and rejects tampering', () => {
  const body = JSON.stringify({ id: 'gid://shopify/PaymentSession/1', amount: '19.99' })
  assert.equal(verifyShopifyHmac(body, sign(body, 'test-secret')), true)
  assert.equal(verifyShopifyHmac(body, sign(body, 'wrong-secret')), false)
  assert.equal(verifyShopifyHmac(body + ' ', sign(body, 'test-secret')), false)
  assert.equal(verifyShopifyHmac(body, ''), false)
})

test('resolvePaymentSession posts the mutation and returns the session', async () => {
  const calls = []
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), token: init.headers['X-Shopify-Access-Token'] })
    return { ok: true, json: async () => ({ data: { paymentSessionResolve: { paymentSession: { id: 'gid://1', status: { code: 'RESOLVED' } }, userErrors: [] } } }) }
  }
  const ps = await resolvePaymentSession('gid://1', fakeFetch)
  assert.equal(ps.status.code, 'RESOLVED')
  assert.match(calls[0].url, /demo\.myshopify\.com\/payments_apps\/api\//)
  assert.equal(calls[0].token, 'tok')
  assert.match(calls[0].body.query, /paymentSessionResolve/)
})

test('resolvePaymentSession throws on userErrors', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ data: { paymentSessionResolve: { paymentSession: null, userErrors: [{ message: 'nope' }] } } }) })
  await assert.rejects(() => resolvePaymentSession('gid://1', fakeFetch), /nope/)
})

test('rejectPaymentSession sends a rejection reason', async () => {
  let sent
  const fakeFetch = async (_url, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ data: { paymentSessionReject: { paymentSession: { id: 'gid://1', status: { code: 'REJECTED' } }, userErrors: [] } } }) } }
  const ps = await rejectPaymentSession('gid://1', 'PROCESSING_ERROR', fakeFetch)
  assert.equal(ps.status.code, 'REJECTED')
  assert.equal(sent.variables.reason.code, 'PROCESSING_ERROR')
})
