/**
 * Lightning (Spark) checkout — pay an order over the Lightning Network.
 *
 * The merchant's back-end mints a BOLT11 invoice for the order amount; the
 * widget shows it (QR + copyable string) and polls until it's paid, then the
 * order completes — the same shape as the on-chain flow, just instant and
 * low-fee. The customer pays from any Lightning wallet (including a WDK Spark
 * wallet).
 *
 * Invoice creation + status are delegated to a {@link LightningProvider} you
 * supply — an adapter over Spark, LNbits, LND-REST, Greenlight, or any service.
 * `createLightningClient` wires a generic REST endpoint (injectable `fetch`,
 * pluggable parsers) so most backends work with a few options and zero code.
 * No node URL or key is hard-coded here; nothing custodies funds in this module.
 */

/** A minted Lightning invoice (BOLT11 is treated as an opaque payment request). */
export interface LightningInvoice {
  /** Provider invoice id / payment hash. */
  readonly id: string
  /** BOLT11 payment request string (what the payer scans/pastes). */
  readonly bolt11: string
  /** Amount in satoshis. */
  readonly amountSats: number
  readonly memo?: string
  /** Unix seconds the invoice was created. */
  readonly createdAt: number
  /** Unix seconds the invoice expires. */
  readonly expiresAt: number
}

export type LightningStatus = 'pending' | 'paid' | 'expired'

/** Normalized status of an invoice. */
export interface LightningInvoiceStatus {
  readonly id: string
  readonly status: LightningStatus
  /** Unix seconds the invoice was paid (when status === 'paid'). */
  readonly paidAt?: number
  /** Payment preimage proof (when the backend returns it). */
  readonly preimage?: string
}

/** Pluggable Lightning backend (Spark/LNbits/LND-REST/your service). */
export interface LightningProvider {
  createInvoice (args: { amountSats: number, memo?: string, expirySeconds?: number }): Promise<LightningInvoice>
  getInvoiceStatus (id: string): Promise<LightningInvoiceStatus>
}

const SATS_PER_BTC = 100_000_000

/** Convert BTC to integer satoshis (rounded). */
export function btcToSats (btc: number): number {
  if (!isFinite(btc) || btc < 0) throw new Error('lightning: btc must be a non-negative finite number')
  return Math.round(btc * SATS_PER_BTC)
}

/** Satoshis needed for a fiat amount, given the BTC price in that fiat. */
export function satsForFiat (args: { fiatAmount: number, btcPriceFiat: number }): number {
  const { fiatAmount, btcPriceFiat } = args
  if (!isFinite(fiatAmount) || fiatAmount < 0) throw new Error('lightning: fiatAmount must be a non-negative finite number')
  if (!isFinite(btcPriceFiat) || btcPriceFiat <= 0) throw new Error('lightning: btcPriceFiat must be a positive finite number')
  return Math.round((fiatAmount / btcPriceFiat) * SATS_PER_BTC)
}

/** Human display for a sats amount, e.g. "1,234 sats". */
export function formatSats (sats: number): string {
  return `${Math.round(sats).toLocaleString('en-US')} sats`
}

/** Map a backend's status field to the normalized {@link LightningStatus}. */
export function normalizeLightningStatus (raw: unknown): LightningStatus {
  if (raw === true) return 'paid'
  const s = String(raw ?? '').toLowerCase()
  if (['paid', 'settled', 'complete', 'completed', 'confirmed', 'success', 'succeeded'].includes(s)) return 'paid'
  if (['expired', 'canceled', 'cancelled', 'failed'].includes(s)) return 'expired'
  return 'pending'
}

/** Options for the generic REST {@link LightningProvider}. */
export interface LightningClientOptions {
  /** Base URL of the merchant's Lightning service. */
  readonly baseUrl: string
  /** Injectable fetch (tests / non-browser). Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
  /** Extra headers, e.g. `{ Authorization: 'Bearer …' }`. */
  readonly headers?: Record<string, string>
  /** Path for creating invoices (POST). Default '/invoices'. */
  readonly createPath?: string
  /** Path for reading an invoice (GET). Default `/invoices/:id`. */
  readonly statusPath?: (id: string) => string
  /** Map a create response to a LightningInvoice. */
  readonly parseInvoice?: (json: unknown) => LightningInvoice
  /** Map a status response to a LightningInvoiceStatus. */
  readonly parseStatus?: (json: unknown) => LightningInvoiceStatus
}

function pick (o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}

function defaultParseInvoice (json: unknown): LightningInvoice {
  const o = (json ?? {}) as Record<string, unknown>
  const id = pick(o, 'id', 'payment_hash', 'paymentHash', 'checking_id', 'r_hash')
  const bolt11 = pick(o, 'bolt11', 'payment_request', 'paymentRequest', 'request', 'invoice')
  const amountSats = Number(pick(o, 'amount_sats', 'amountSats', 'amount', 'value') ?? 0)
  const now = Math.floor(Date.now() / 1000)
  const createdAt = Number(pick(o, 'created_at', 'createdAt', 'timestamp') ?? now)
  const expiresAt = Number(pick(o, 'expires_at', 'expiresAt', 'expiry') ?? (now + 3600))
  if (typeof id !== 'string' || typeof bolt11 !== 'string') {
    throw new Error('lightning: could not parse invoice (missing id/bolt11); pass opts.parseInvoice')
  }
  return { id, bolt11, amountSats, createdAt, expiresAt }
}

function defaultParseStatus (json: unknown): LightningInvoiceStatus {
  const o = (json ?? {}) as Record<string, unknown>
  const id = String(pick(o, 'id', 'payment_hash', 'paymentHash', 'checking_id') ?? '')
  const rawStatus = pick(o, 'status', 'state', 'paid', 'settled')
  const status = normalizeLightningStatus(rawStatus)
  const out: LightningInvoiceStatus = { id, status }
  const paidAt = pick(o, 'paid_at', 'paidAt', 'settled_at')
  const preimage = pick(o, 'preimage', 'payment_preimage', 'r_preimage')
  return {
    ...out,
    ...(paidAt !== undefined ? { paidAt: Number(paidAt) } : {}),
    ...(typeof preimage === 'string' ? { preimage } : {})
  }
}

/** A {@link LightningProvider} backed by a generic REST endpoint. */
export function createLightningClient (opts: LightningClientOptions): LightningProvider {
  const f = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined)
  const createPath = opts.createPath ?? '/invoices'
  const statusPath = opts.statusPath ?? ((id: string) => `/invoices/${encodeURIComponent(id)}`)
  const parseInvoice = opts.parseInvoice ?? defaultParseInvoice
  const parseStatus = opts.parseStatus ?? defaultParseStatus
  const base = opts.baseUrl.replace(/\/$/, '')

  function headers (json: boolean): Record<string, string> {
    return { ...(json ? { 'content-type': 'application/json' } : {}), ...(opts.headers ?? {}) }
  }
  function ensureFetch (): typeof fetch {
    if (typeof f !== 'function') throw new Error('lightning: no fetch available; pass opts.fetchImpl')
    return f
  }

  return {
    async createInvoice (args) {
      const res = await ensureFetch()(`${base}${createPath}`, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ amount_sats: args.amountSats, memo: args.memo, expiry: args.expirySeconds })
      })
      if (!res.ok) throw new Error(`lightning: createInvoice HTTP ${res.status}`)
      return parseInvoice(await res.json())
    },
    async getInvoiceStatus (id) {
      const res = await ensureFetch()(`${base}${statusPath(id)}`, { headers: headers(false) })
      if (!res.ok) throw new Error(`lightning: getInvoiceStatus HTTP ${res.status}`)
      return parseStatus(await res.json())
    }
  }
}

/**
 * Poll an invoice until it is paid or expired (or a timeout elapses). `sleep`
 * and `now` are injectable so this is deterministic in tests. Resolves with the
 * terminal status; rejects only on timeout.
 */
export async function pollInvoice (args: {
  provider: LightningProvider
  id: string
  intervalMs?: number
  timeoutMs?: number
  onUpdate?: (s: LightningInvoiceStatus) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Promise<LightningInvoiceStatus> {
  const intervalMs = args.intervalMs ?? 3000
  const timeoutMs = args.timeoutMs ?? 15 * 60 * 1000
  const now = args.now ?? (() => Date.now())
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const start = now()

  for (;;) {
    const status = await args.provider.getInvoiceStatus(args.id)
    args.onUpdate?.(status)
    if (status.status === 'paid' || status.status === 'expired') return status
    if (now() - start >= timeoutMs) throw new Error('lightning: poll timed out before the invoice settled')
    await sleep(intervalMs)
  }
}
