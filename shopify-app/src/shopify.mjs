/**
 * Shopify Payments Apps API client + request authentication.
 *
 * A WDK Pay payment session is settled off-platform (self-custodial USDt), then
 * the app tells Shopify the result through the Payments Apps API:
 *   - paymentSessionResolve  → the buyer paid and we verified it on-chain.
 *   - paymentSessionReject   → verification failed / the buyer abandoned.
 *
 * Shopify signs its POSTs (payment sessions, webhooks) with an HMAC-SHA256 over
 * the raw body using the app's API secret; `verifyShopifyHmac` checks it in
 * constant time. No funds pass through Shopify — it only learns the outcome.
 */

import crypto from 'node:crypto'
import { config } from './config.mjs'

/** Verify Shopify's base64 `X-Shopify-Hmac-Sha256` over the RAW request body. */
export function verifyShopifyHmac (rawBody, hmacHeader) {
  if (!config.apiSecret || !hmacHeader) return false
  const digest = crypto.createHmac('sha256', config.apiSecret).update(rawBody, 'utf8').digest('base64')
  const a = Buffer.from(digest)
  const b = Buffer.from(String(hmacHeader))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function paymentsApiUrl () {
  return `https://${config.shop}/payments_apps/api/${config.apiVersion}/graphql.json`
}

async function gql (query, variables, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(paymentsApiUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': config.accessToken },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify Payments API HTTP ${res.status}`)
  const json = await res.json()
  if (json.errors) throw new Error(`Shopify Payments API: ${JSON.stringify(json.errors)}`)
  return json.data
}

const RESOLVE = `mutation Resolve($id: ID!) {
  paymentSessionResolve(id: $id) {
    paymentSession { id status { code } }
    userErrors { field message }
  }
}`

const REJECT = `mutation Reject($id: ID!, $reason: PaymentSessionRejectionReasonInput!) {
  paymentSessionReject(id: $id, reason: $reason) {
    paymentSession { id status { code } }
    userErrors { field message }
  }
}`

/** Mark a Shopify payment session paid (after on-chain verification). */
export async function resolvePaymentSession (id, fetchImpl) {
  const data = await gql(RESOLVE, { id }, fetchImpl)
  const errs = data?.paymentSessionResolve?.userErrors ?? []
  if (errs.length) throw new Error(`paymentSessionResolve: ${errs.map((e) => e.message).join('; ')}`)
  return data.paymentSessionResolve.paymentSession
}

/** Reject a Shopify payment session (verification failed / abandoned). */
export async function rejectPaymentSession (id, code = 'PROCESSING_ERROR', fetchImpl) {
  const data = await gql(REJECT, { id, reason: { code } }, fetchImpl)
  const errs = data?.paymentSessionReject?.userErrors ?? []
  if (errs.length) throw new Error(`paymentSessionReject: ${errs.map((e) => e.message).join('; ')}`)
  return data.paymentSessionReject.paymentSession
}
