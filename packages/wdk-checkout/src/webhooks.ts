/**
 * Payment-status webhooks (Phase 4 item 10) — notify a merchant back-end when an
 * order's payment state changes, signed so the receiver can trust it.
 *
 * The WooCommerce plugin fires these server-side (PHP `hash_hmac`) on
 * confirm/fail; this module is the framework-free JS half: build a canonical
 * event, sign it (HMAC-SHA256 over the exact JSON body), and verify a received
 * signature. Signing/verifying use Web Crypto (`crypto.subtle`), available in
 * modern browsers and Node ≥ 18 — so a Node/edge back-end and the browser agree.
 *
 * The signature is sent in the `X-WDK-Signature` header as `sha256=<hex>`.
 */

export type WebhookEventType = 'payment.confirmed' | 'payment.pending' | 'payment.failed'

export interface WebhookEvent {
  readonly type: WebhookEventType
  readonly orderId: number | string
  readonly orderKey: string
  readonly status: string
  readonly txHash?: string
  readonly chainId?: number
  readonly amount?: string
  readonly token?: string
  /** Unix seconds (caller-supplied so the body is deterministic/replayable). */
  readonly timestamp: number
}

/** The header name carrying the signature. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-WDK-Signature'

/** Build a canonical webhook event (drops undefined fields for a stable body). */
export function buildWebhookEvent (
  type: WebhookEventType,
  fields: Omit<WebhookEvent, 'type'>,
): WebhookEvent {
  const e: Record<string, unknown> = { type }
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) e[k] = v
  }
  return e as unknown as WebhookEvent
}

/** Serialize an event to its exact signed body (stable key order). */
export function webhookBody (event: WebhookEvent): string {
  const ordered: Record<string, unknown> = {}
  const src = event as unknown as Record<string, unknown>
  for (const k of Object.keys(src).sort()) ordered[k] = src[k]
  return JSON.stringify(ordered)
}

function toHex (buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacHex (secret: string, body: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return toHex(sig)
}

/** Sign a webhook body → `sha256=<hex>` (the `X-WDK-Signature` value). */
export async function signWebhook (secret: string, body: string): Promise<string> {
  return `sha256=${await hmacHex(secret, body)}`
}

/** Constant-time-ish equality for two equal-length hex strings. */
function safeEqual (a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Verify a received `X-WDK-Signature` against the body. Tolerates the `sha256=` prefix. */
export async function verifyWebhook (secret: string, body: string, signature: string): Promise<boolean> {
  const expected = await hmacHex(secret, body)
  const got = signature.startsWith('sha256=') ? signature.slice(7) : signature
  return safeEqual(expected.toLowerCase(), got.toLowerCase())
}
