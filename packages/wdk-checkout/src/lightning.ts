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

// Sats math lives in the shared `sats` module (also used by the on-chain BTC
// rail); re-exported here so `wdk-checkout/lightning` keeps the same surface.
export { SATS_PER_BTC, btcToSats, satsForFiat, formatSats } from './sats.js'

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

// ─────────────────────────── Spark-backed provider ──────────────────────────

/**
 * Narrow view of a WDK Spark account's Lightning-receive surface. Typed locally
 * (not imported from `@tetherto/wdk-wallet-spark`) so this package pulls in no
 * SDK — the merchant constructs the account and hands it in. Mirrors the
 * F-WDK-04 narrow-interface boundary the wallet engine uses for Spark.
 */
export interface SparkLightningAccount {
  createLightningInvoice (opts: { amountSats: number, memo?: string, expirySeconds?: number }): Promise<unknown>
  getLightningReceiveRequest (invoiceId: string): Promise<unknown>
}

export interface SparkLightningProviderOptions {
  /** Override status mapping if your SDK build reports different status strings. */
  readonly mapStatus?: (request: unknown) => LightningStatus
}

/** Reads the BOLT11 (`encodedInvoice`) out of a Spark `LightningReceiveRequest`. */
function sparkBolt11 (r: unknown): string {
  const o = (r ?? {}) as { invoice?: { encodedInvoice?: unknown }, encodedInvoice?: unknown }
  const enc = o.invoice?.encodedInvoice ?? o.encodedInvoice
  if (typeof enc !== 'string' || enc.length === 0) {
    throw new Error('spark: Lightning receive request carried no encodedInvoice (BOLT11)')
  }
  return enc
}

/** Reads the request id out of a Spark `LightningReceiveRequest`. */
function sparkReceiveId (r: unknown): string {
  const o = (r ?? {}) as { id?: unknown }
  if (typeof o.id !== 'string' || o.id.length === 0) {
    throw new Error('spark: Lightning receive request carried no id')
  }
  return o.id
}

/**
 * Default status mapping for a Spark `LightningReceiveRequest`. Tolerant of the
 * SDK's status-string variations: a recovered preimage or a completed transfer
 * (or a received/settled/success status) means paid; expired/cancelled means
 * expired; everything else is still pending. Override via `opts.mapStatus`.
 */
export function normalizeSparkReceiveStatus (request: unknown): LightningStatus {
  const o = (request ?? {}) as Record<string, unknown>
  const raw = String(o.status ?? '').toLowerCase()
  if (raw.includes('expired') || raw.includes('cancel')) return 'expired'
  if (o.paymentPreimage != null || o.transfer != null || /received|complete|settled|success|paid|preimage/.test(raw)) {
    return 'paid'
  }
  return 'pending'
}

/**
 * A {@link LightningProvider} backed by a WDK Spark account: the merchant accepts
 * Lightning payments straight into their own Spark wallet — self-custodial, no
 * third-party Lightning service. Pass an account from `@tetherto/wdk-wallet-spark`
 * (it satisfies {@link SparkLightningAccount}); this package imports no SDK.
 */
export function createSparkLightningProvider (
  account: SparkLightningAccount,
  opts: SparkLightningProviderOptions = {}
): LightningProvider {
  const mapStatus = opts.mapStatus ?? normalizeSparkReceiveStatus
  return {
    async createInvoice (args) {
      const r = await account.createLightningInvoice({
        amountSats: args.amountSats,
        ...(args.memo !== undefined ? { memo: args.memo } : {}),
        ...(args.expirySeconds !== undefined ? { expirySeconds: args.expirySeconds } : {})
      })
      const now = Math.floor(Date.now() / 1000)
      const expirySeconds = args.expirySeconds ?? 3600
      return {
        id: sparkReceiveId(r),
        bolt11: sparkBolt11(r),
        amountSats: args.amountSats,
        ...(args.memo !== undefined ? { memo: args.memo } : {}),
        createdAt: now,
        expiresAt: now + expirySeconds
      }
    },
    async getInvoiceStatus (id) {
      const r = await account.getLightningReceiveRequest(id)
      const o = (r ?? {}) as Record<string, unknown>
      const preimage = o.paymentPreimage ?? o.preimage
      return {
        id,
        status: mapStatus(r),
        ...(typeof preimage === 'string' ? { preimage } : {})
      }
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
