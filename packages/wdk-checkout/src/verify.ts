/**
 * On-chain payment verification (server-side) — `wdk-checkout/verify`.
 *
 * The JS mirror of the WooCommerce plugin's PHP verifier, so a non-WooCommerce
 * backend (the Shopify app, the merchant-server example, a Worker) can verify an
 * ERC-20 (USDt) transfer with the SAME rules, with no dependency beyond `fetch`:
 *
 *   1. eth_getTransactionReceipt(txHash) must exist and have status == 0x1.
 *   2. Among the receipt logs, a Transfer event whose emitter is the configured
 *      token, whose indexed `to` is the merchant address, and whose value is
 *      >= the required base amount.
 *   3. Confirmations (head - receipt.block + 1) must meet the threshold.
 *
 * `fetch` is injectable (tests / non-browser). Big-number math is native BigInt,
 * so uint256 values are exact. Nothing here holds keys — it only reads the chain.
 */

/** keccak256("Transfer(address,address,uint256)") — the ERC-20 Transfer topic. */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export type VerifyStatus = 'confirmed' | 'pending' | 'failed'

/** Normalized verification result. */
export interface VerifyResult {
  readonly status: VerifyStatus
  readonly message: string
  /** Confirmations seen (when a matching transfer was found). */
  readonly confirmations?: number
  /** The matched transfer's value in base units (decimal string). */
  readonly valueBase?: string
}

export interface VerifyOptions {
  /** JSON-RPC endpoint for the chain the payment settled on. */
  readonly rpcUrl: string
  /** The transaction hash to verify (0x + 64 hex). */
  readonly txHash: string
  /** The expected token (USDt) contract address. */
  readonly token: string
  /** The expected recipient (merchant) address. */
  readonly to: string
  /** Minimum required amount in base units (bigint or decimal string). */
  readonly minAmountBase: bigint | string
  /** Confirmations required for `confirmed` (default 1). */
  readonly confirmations?: number
  /** Injectable fetch (defaults to global fetch). */
  readonly fetchImpl?: typeof fetch
  /** Per-request timeout in ms (default 20000). */
  readonly timeoutMs?: number
}

const TX_RE = /^0x[0-9a-fA-F]{64}$/
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/

/** Lowercase + validate an EVM address; null when malformed. */
export function normalizeAddress (address: string): string | null {
  const a = (address ?? '').trim()
  return ADDR_RE.test(a) ? a.toLowerCase() : null
}

/** Extract the 20-byte address from a 32-byte indexed topic (last 40 hex). */
export function topicToAddress (topic: string): string | null {
  const t = (topic ?? '').trim().toLowerCase().replace(/^0x/, '')
  if (t.length < 40 || !/^[0-9a-f]+$/.test(t)) return null
  return '0x' + t.slice(-40)
}

/** Parse a 0x hex quantity to BigInt (0n on empty/invalid). */
export function hexToBigInt (hex: string): bigint {
  const h = (hex ?? '').trim().toLowerCase()
  if (!/^0x[0-9a-f]*$/.test(h) || h === '0x') return 0n
  return BigInt(h)
}

interface RpcLog { address?: string, topics?: string[], data?: string }
interface RpcReceipt { status?: string, blockNumber?: string, logs?: RpcLog[] }

/**
 * Find a Transfer log matching token (emitter), recipient (indexed `to`), and a
 * minimum value. Pure and unit-tested — the security-critical matching lives here.
 */
export function findMatchingTransfer (
  logs: RpcLog[],
  token: string,
  to: string,
  minAmountBase: bigint,
): { valueBase: string } | null {
  const tokenNorm = normalizeAddress(token)
  const toNorm = normalizeAddress(to)
  if (!tokenNorm || !toNorm) return null

  for (const log of Array.isArray(logs) ? logs : []) {
    const topics = Array.isArray(log?.topics) ? log.topics : []
    if (topics.length < 3) continue
    if ((topics[0] ?? '').toLowerCase() !== TRANSFER_TOPIC) continue

    const emitter = normalizeAddress(log.address ?? '')
    if (!emitter || emitter !== tokenNorm) continue

    const logTo = topicToAddress(topics[2] ?? '')
    if (!logTo || logTo !== toNorm) continue

    const value = hexToBigInt(log.data ?? '0x0')
    if (value >= minAmountBase) return { valueBase: value.toString() }
  }
  return null
}

/** A single JSON-RPC call over fetch. Throws on transport / RPC error. */
async function rpcCall (opts: { rpcUrl: string, method: string, params: unknown[], fetchImpl: typeof fetch, timeoutMs: number }): Promise<unknown> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined
  try {
    const res = await opts.fetchImpl(opts.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: opts.method, params: opts.params }),
      ...(controller ? { signal: controller.signal } : {}),
    })
    if (!res.ok) throw new Error(`verify: RPC HTTP ${res.status}`)
    const json = (await res.json()) as { result?: unknown, error?: { message?: string } }
    if (json.error) throw new Error(`verify: RPC error ${json.error.message ?? 'unknown'}`)
    return json.result ?? null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Verify an on-chain USDt transfer for an order. Mirrors the PHP verifier's
 * semantics: a missing receipt or a transient RPC failure is `pending` (keep
 * polling); a revert or no-matching-transfer is `failed`; too-few-confirmations
 * is `pending`; otherwise `confirmed`.
 */
export async function verifyTransfer (opts: VerifyOptions): Promise<VerifyResult> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined)
  if (typeof fetchImpl !== 'function') return { status: 'pending', message: 'No fetch available; pass opts.fetchImpl.' }
  if (!TX_RE.test(opts.txHash)) return { status: 'failed', message: 'Malformed transaction hash.' }
  if (!opts.rpcUrl) return { status: 'failed', message: 'No RPC endpoint configured for verification.' }

  const required = Math.max(1, opts.confirmations ?? 1)
  const minAmount = typeof opts.minAmountBase === 'bigint' ? opts.minAmountBase : BigInt(opts.minAmountBase)
  const timeoutMs = opts.timeoutMs ?? 20000
  const call = (method: string, params: unknown[]) => rpcCall({ rpcUrl: opts.rpcUrl, method, params, fetchImpl, timeoutMs })

  // 1. Receipt.
  let receipt: RpcReceipt | null
  try {
    receipt = (await call('eth_getTransactionReceipt', [opts.txHash])) as RpcReceipt | null
  } catch {
    return { status: 'pending', message: 'Unable to reach RPC node; will retry.' }
  }
  if (!receipt || typeof receipt !== 'object') return { status: 'pending', message: 'Transaction not yet mined.' }
  if ((receipt.status ?? '').toLowerCase() !== '0x1') return { status: 'failed', message: 'Transaction reverted on-chain.' }

  // 2. Matching Transfer.
  const transfer = findMatchingTransfer(receipt.logs ?? [], opts.token, opts.to, minAmount)
  if (!transfer) return { status: 'failed', message: 'No matching USDt transfer to the receiving address for the required amount.' }

  // 3. Confirmations.
  if (!receipt.blockNumber) return { status: 'pending', message: 'Receipt has no block number yet.' }
  const receiptBlock = hexToBigInt(receipt.blockNumber)
  let head: bigint
  try {
    head = hexToBigInt((await call('eth_blockNumber', [])) as string)
  } catch {
    return { status: 'pending', message: 'Unable to read chain head; will retry.' }
  }
  const confirmations = Number(head - receiptBlock + 1n)
  if (confirmations < required) {
    return { status: 'pending', message: 'Awaiting additional confirmations.', confirmations: Math.max(0, confirmations), valueBase: transfer.valueBase }
  }
  return { status: 'confirmed', message: 'Payment confirmed on-chain.', confirmations, valueBase: transfer.valueBase }
}
