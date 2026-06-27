/**
 * Bitcoin on-chain checkout — pay an order with native BTC (BIP-84 / bech32).
 *
 * The merchant exposes a receiving address for the order (ideally a *fresh*
 * BIP-84 address per order, derived from their WDK BTC account, so payments are
 * attributable and private); the widget shows it (QR + a BIP-21 URI) and polls
 * a block explorer until a confirmed payment of at least the order amount lands
 * — the same shape as the Lightning and on-chain USDt flows, just settling in
 * BTC.
 *
 * Address derivation and chain-watching are delegated to small pluggable seams:
 *   - a {@link BitcoinAddressSource} provides the per-order address (wrap a WDK
 *     `@tetherto/wdk-wallet-btc` account, or use {@link staticAddressSource}),
 *   - a {@link BitcoinWatcher} reports an address's funded amount + confirmations
 *     ({@link createEsploraWatcher} wires any Esplora/mempool.space REST API).
 *
 * No node URL or key is hard-coded here, and nothing custodies funds in this
 * module — it imports no SDK; the merchant constructs the account and hands it in
 * (mirroring the narrow-interface boundary the wallet engine uses).
 */

import { SATS_PER_BTC, btcToSats, satsToBtcString, satsForFiat, formatSats } from './sats.js'

// Re-export the shared sats helpers so consumers of this rail have them to hand.
export { SATS_PER_BTC, btcToSats, satsToBtcString, satsForFiat, formatSats }

/** A receiving request for an on-chain BTC payment. */
export interface BitcoinPaymentRequest {
  /** The bech32 (or legacy) address the customer pays. */
  readonly address: string
  /** Amount in satoshis the order requires. */
  readonly amountSats: number
  /** A ready-to-render BIP-21 URI (`bitcoin:<addr>?amount=…&label=…`). */
  readonly uri: string
  /** Unix seconds the request was created. */
  readonly createdAt: number
  /** Unix seconds the request expires (the customer should pay before this). */
  readonly expiresAt: number
}

export type BitcoinStatus = 'pending' | 'paid' | 'expired'

/** Normalized on-chain status for a watched address. */
export interface BitcoinPaymentStatus {
  readonly address: string
  readonly status: BitcoinStatus
  /** Total satoshis received by the address so far (confirmed + mempool). */
  readonly receivedSats: number
  /** Confirmations on the funding transaction (0 while in the mempool). */
  readonly confirmations: number
  /** The funding transaction id, when one paying the address has been seen. */
  readonly txid?: string
}

/** Supplies the receiving address for an order. */
export interface BitcoinAddressSource {
  /**
   * Return the address to receive into for a given order reference. Implementations
   * should derive a *fresh* address per order where possible (privacy + clean
   * attribution); {@link staticAddressSource} returns one fixed address.
   */
  nextAddress (orderRef: string): Promise<string> | string
}

/** Reports how much an address has received and with how many confirmations. */
export interface BitcoinWatcher {
  getAddressStatus (address: string, opts: { minAmountSats: number, requiredConfirmations: number }): Promise<BitcoinPaymentStatus>
}

// ───────────────────────────── BIP-21 + requests ─────────────────────────────

const BIP21_LABEL_MAX = 128

/**
 * Build a BIP-21 payment URI. The amount is encoded in BTC (per BIP-21), derived
 * exactly from integer sats so there's no float drift. `label`/`message` are
 * URI-encoded and length-capped.
 */
export function buildBip21Uri (args: { address: string, amountSats: number, label?: string, message?: string }): string {
  const address = String(args.address ?? '').trim()
  if (address === '') throw new Error('bitcoin: address is required for a BIP-21 URI')
  const params: string[] = []
  if (args.amountSats > 0) params.push(`amount=${satsToBtcString(args.amountSats)}`)
  if (args.label) params.push(`label=${encodeURIComponent(args.label.slice(0, BIP21_LABEL_MAX))}`)
  if (args.message) params.push(`message=${encodeURIComponent(args.message.slice(0, BIP21_LABEL_MAX))}`)
  return `bitcoin:${address}${params.length ? `?${params.join('&')}` : ''}`
}

/** A fixed-address {@link BitcoinAddressSource}. Note: reusing one address across
 * orders is less private and makes attribution amount/time-based — prefer a
 * derived source in production. */
export function staticAddressSource (address: string): BitcoinAddressSource {
  const addr = String(address ?? '').trim()
  if (addr === '') throw new Error('bitcoin: staticAddressSource needs a non-empty address')
  return { nextAddress: () => addr }
}

/**
 * Narrow view of a WDK BTC account's receive surface (BIP-84). Typed locally so
 * this package imports no SDK; the merchant constructs the account (from
 * `@tetherto/wdk-wallet-btc`) and hands it in. Any of the listed method shapes is
 * accepted, so it adapts across SDK minor versions.
 */
export interface BitcoinReceiver {
  getReceiveAddress?: (opts?: { index?: number }) => Promise<string> | string
  getNewAddress?: () => Promise<string> | string
  deriveAddress?: (index: number) => Promise<string> | string
  receiveAddress?: string
}

/**
 * Adapt a WDK BTC account into a {@link BitcoinAddressSource}. Calls whichever
 * receive method the account exposes; falls back to a static `receiveAddress`.
 */
export function accountAddressSource (account: BitcoinReceiver): BitcoinAddressSource {
  return {
    async nextAddress (): Promise<string> {
      if (typeof account.getReceiveAddress === 'function') return String(await account.getReceiveAddress())
      if (typeof account.getNewAddress === 'function') return String(await account.getNewAddress())
      if (typeof account.deriveAddress === 'function') return String(await account.deriveAddress(0))
      if (typeof account.receiveAddress === 'string' && account.receiveAddress !== '') return account.receiveAddress
      throw new Error('bitcoin: account exposes no receive-address method')
    }
  }
}

/**
 * Build a {@link BitcoinPaymentRequest} for an order: resolve the address from the
 * source, price it in sats, and assemble the BIP-21 URI. `now`/`expirySeconds`
 * are injectable for deterministic tests.
 */
export async function createBitcoinPaymentRequest (args: {
  source: BitcoinAddressSource
  orderRef: string
  amountSats: number
  label?: string
  message?: string
  expirySeconds?: number
  now?: () => number
}): Promise<BitcoinPaymentRequest> {
  if (!Number.isFinite(args.amountSats) || args.amountSats <= 0) {
    throw new Error('bitcoin: amountSats must be a positive number')
  }
  const now = args.now ?? (() => Date.now())
  const createdAt = Math.floor(now() / 1000)
  const expirySeconds = args.expirySeconds ?? 3600
  const address = String(await args.source.nextAddress(args.orderRef)).trim()
  if (address === '') throw new Error('bitcoin: address source returned an empty address')
  return {
    address,
    amountSats: args.amountSats,
    uri: buildBip21Uri({ address, amountSats: args.amountSats, ...(args.label ? { label: args.label } : {}), ...(args.message ? { message: args.message } : {}) }),
    createdAt,
    expiresAt: createdAt + expirySeconds
  }
}

// ─────────────────────────── Esplora-backed watcher ──────────────────────────

/** Options for the Esplora/mempool.space REST {@link BitcoinWatcher}. */
export interface EsploraWatcherOptions {
  /** Base URL, e.g. `https://mempool.space/api` or a self-hosted Esplora. */
  readonly baseUrl: string
  /** Injectable fetch (tests / non-browser). Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
  /** Extra headers (e.g. an API key). */
  readonly headers?: Record<string, string>
}

interface EsploraVout { scriptpubkey_address?: string, value?: number }
interface EsploraTxStatus { confirmed?: boolean, block_height?: number }
interface EsploraTx { txid?: string, vout?: EsploraVout[], status?: EsploraTxStatus }

/** Sum the outputs of a tx that pay a given address (in sats). */
export function sumOutputsToAddress (tx: EsploraTx, address: string): number {
  const outs = Array.isArray(tx.vout) ? tx.vout : []
  let total = 0
  for (const o of outs) {
    if (o && o.scriptpubkey_address === address) total += Number(o.value ?? 0)
  }
  return total
}

/**
 * Decide an address's payment status from its tx list + the chain tip. Pure and
 * unit-tested: picks the first tx paying ≥ `minAmountSats`, computes its
 * confirmations against `tipHeight`, and returns paid/pending accordingly. A
 * confirmed-but-too-few-confs or mempool tx is `pending` (with the count).
 */
export function evaluateAddressTxs (
  txs: EsploraTx[],
  address: string,
  opts: { minAmountSats: number, requiredConfirmations: number, tipHeight: number }
): BitcoinPaymentStatus {
  const required = Math.max(1, opts.requiredConfirmations)
  let best: { received: number, confirmations: number, txid?: string } | null = null

  for (const tx of Array.isArray(txs) ? txs : []) {
    const received = sumOutputsToAddress(tx, address)
    if (received < opts.minAmountSats) continue
    const confirmed = tx.status?.confirmed === true
    const confirmations = confirmed && typeof tx.status?.block_height === 'number'
      ? Math.max(0, opts.tipHeight - (tx.status.block_height as number) + 1)
      : 0
    // Prefer the most-confirmed qualifying tx.
    if (!best || confirmations > best.confirmations) {
      best = { received, confirmations, ...(tx.txid ? { txid: tx.txid } : {}) }
    }
  }

  if (!best) {
    return { address, status: 'pending', receivedSats: 0, confirmations: 0 }
  }
  const status: BitcoinStatus = best.confirmations >= required ? 'paid' : 'pending'
  return {
    address,
    status,
    receivedSats: best.received,
    confirmations: best.confirmations,
    ...(best.txid ? { txid: best.txid } : {})
  }
}

/** A {@link BitcoinWatcher} backed by an Esplora-compatible REST API
 * (mempool.space, Blockstream, or a self-hosted Esplora). */
export function createEsploraWatcher (opts: EsploraWatcherOptions): BitcoinWatcher {
  const f = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined)
  const base = opts.baseUrl.replace(/\/$/, '')

  function ensureFetch (): typeof fetch {
    if (typeof f !== 'function') throw new Error('bitcoin: no fetch available; pass opts.fetchImpl')
    return f
  }
  async function getJson (path: string): Promise<unknown> {
    const res = await ensureFetch()(`${base}${path}`, { headers: { ...(opts.headers ?? {}) } })
    if (!res.ok) throw new Error(`bitcoin: Esplora HTTP ${res.status} for ${path}`)
    return res.json()
  }

  return {
    async getAddressStatus (address, statusOpts) {
      const addr = String(address).trim()
      if (addr === '') throw new Error('bitcoin: getAddressStatus needs an address')
      const [txs, tipRaw] = await Promise.all([
        getJson(`/address/${encodeURIComponent(addr)}/txs`) as Promise<EsploraTx[]>,
        getJson('/blocks/tip/height')
      ])
      const tipHeight = Number(tipRaw ?? 0)
      return evaluateAddressTxs(Array.isArray(txs) ? txs : [], addr, {
        minAmountSats: statusOpts.minAmountSats,
        requiredConfirmations: statusOpts.requiredConfirmations,
        tipHeight
      })
    }
  }
}

/**
 * Poll a watched address until it is paid or the request expires (or a timeout
 * elapses). `now`/`sleep` are injectable so this is deterministic in tests.
 * Resolves with the terminal status; rejects only on timeout.
 */
export async function watchAddress (args: {
  watcher: BitcoinWatcher
  request: BitcoinPaymentRequest
  requiredConfirmations?: number
  intervalMs?: number
  timeoutMs?: number
  onUpdate?: (s: BitcoinPaymentStatus) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Promise<BitcoinPaymentStatus> {
  const requiredConfirmations = Math.max(1, args.requiredConfirmations ?? 1)
  const intervalMs = args.intervalMs ?? 15000
  const timeoutMs = args.timeoutMs ?? 60 * 60 * 1000
  const now = args.now ?? (() => Date.now())
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const start = now()

  for (;;) {
    const status = await args.watcher.getAddressStatus(args.request.address, {
      minAmountSats: args.request.amountSats,
      requiredConfirmations
    })
    args.onUpdate?.(status)
    if (status.status === 'paid') return status
    // Expired by the request window (reached here only when not yet paid).
    if (Math.floor(now() / 1000) >= args.request.expiresAt) {
      return { ...status, status: 'expired' }
    }
    if (now() - start >= timeoutMs) throw new Error('bitcoin: poll timed out before the payment confirmed')
    await sleep(intervalMs)
  }
}
