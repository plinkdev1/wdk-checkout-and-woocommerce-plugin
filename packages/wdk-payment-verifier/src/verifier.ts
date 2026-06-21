/**
 * wdk-payment-verifier — server-side on-chain confirmation of WDK Pay payments.
 *
 * A payment is a plain ERC-20 transfer of the settlement token to the merchant.
 * Verification = observe the chain (read-only JSON-RPC) and confirm a
 * `Transfer(token, to = merchant, value ≥ due)` landed with enough
 * confirmations. No keys, no custody — the merchant only watches.
 *
 * This is the standalone library counterpart to the WooCommerce plugin's PHP
 * verifier, for Node back-ends / headless commerce. The RPC provider is
 * injectable (pass an `rpcUrl`, an ethers provider, or any minimal provider for
 * tests); nothing is hard-coded.
 */
import { getAddress } from 'ethers'

/** keccak256("Transfer(address,address,uint256)") — the ERC-20 Transfer topic. */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/** The minimum a verifier needs to know about an order to confirm payment. */
export interface VerifierIntent {
  /** Settlement token contract (the Transfer emitter), e.g. USDt. */
  readonly tokenAddress: string
  /** Merchant receiving address (the Transfer `to`). */
  readonly receivingAddress: string
  /** Minimum amount required, in token base units (decimal string). */
  readonly amountBase: string
}

export type PaymentStatus = 'confirmed' | 'pending' | 'failed'

/** The outcome of a verification. */
export interface PaymentConfirmation {
  readonly status: PaymentStatus
  readonly txHash?: string
  readonly blockNumber?: number
  readonly confirmations?: number
  /** The matched transfer's value, base units. */
  readonly valueBase?: string
  /** The payer (the Transfer `from`). */
  readonly fromAddress?: string
  /** Unix ms when confirmed. */
  readonly receivedAt?: number
  /** Machine-readable reason for pending/failed. */
  readonly reason?: string
}

/** A single log entry (subset of an eth_getLogs / receipt log). */
export interface EvmLog {
  readonly address: string
  readonly topics: readonly string[]
  readonly data: string
  readonly blockNumber?: number
  readonly transactionHash?: string
}

/** A transaction receipt subset. */
export interface EvmReceipt {
  readonly status?: number | null
  readonly blockNumber: number
  readonly logs: readonly EvmLog[]
  readonly transactionHash?: string
}

/**
 * Minimal read-only provider the verifier needs. An ethers `JsonRpcProvider`
 * satisfies it; tests pass a fake. (ethers receipts expose `logs` and a numeric
 * `status`; `getLogs` returns the same log shape.)
 */
export interface EvmReadProvider {
  getTransactionReceipt (txHash: string): Promise<EvmReceipt | null>
  getBlockNumber (): Promise<number>
  getLogs (filter: {
    address?: string
    topics?: (string | null)[]
    fromBlock?: number | string
    toBlock?: number | string
  }): Promise<readonly EvmLog[]>
}

export interface PaymentVerifierOptions {
  /** A ready provider (e.g. ethers JsonRpcProvider) — preferred for reuse. */
  readonly provider?: EvmReadProvider
  /** Or a JSON-RPC URL; an ethers JsonRpcProvider is created lazily. */
  readonly rpcUrl?: string
}

export interface WatchOptions {
  /** Confirmations required before `confirmed`. Default 1. */
  readonly requiredConfirmations?: number
  /** Give up after this many ms (resolves `pending`/`timeout`). Default 15 min. */
  readonly timeoutMs?: number
  /** Poll cadence. Default 5s. */
  readonly pollIntervalMs?: number
  /** Block to scan logs from. Default: latest − 5000 (or 0). */
  readonly fromBlock?: number
  /** Injectable sleep for deterministic tests. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Injectable clock (ms) for deterministic tests. */
  readonly now?: () => number
}

/** A 32-byte topic word → checksummed address (last 20 bytes). */
function topicToAddress (topic: string): string {
  return getAddress('0x' + topic.slice(-40))
}

function eq (a: string, b: string): boolean {
  try { return getAddress(a) === getAddress(b) } catch { return false }
}

/**
 * Find a Transfer log in `logs` matching the intent (emitter = token,
 * to = recipient, value ≥ amount). Returns the match or null.
 */
export function matchTransfer (
  logs: readonly EvmLog[],
  intent: VerifierIntent
): { value: bigint, from: string, log: EvmLog } | null {
  const need = BigInt(intent.amountBase)
  for (const log of logs) {
    if (!log.topics || log.topics.length < 3) continue
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue
    if (!eq(log.address, intent.tokenAddress)) continue
    if (!eq(topicToAddress(log.topics[2]!), intent.receivingAddress)) continue
    let value: bigint
    try { value = BigInt(log.data) } catch { continue }
    if (value < need) continue
    return { value, from: topicToAddress(log.topics[1]!), log }
  }
  return null
}

export class PaymentVerifier {
  #provider: EvmReadProvider | undefined
  readonly #rpcUrl: string | undefined

  constructor (opts: PaymentVerifierOptions) {
    if (!opts.provider && !opts.rpcUrl) throw new Error('PaymentVerifier: pass `provider` or `rpcUrl`.')
    this.#provider = opts.provider
    this.#rpcUrl = opts.rpcUrl
  }

  async #getProvider (): Promise<EvmReadProvider> {
    if (this.#provider) return this.#provider
    const { JsonRpcProvider } = await import('ethers')
    this.#provider = new JsonRpcProvider(this.#rpcUrl) as unknown as EvmReadProvider
    return this.#provider
  }

  /**
   * Verify a specific transaction satisfies the intent. One-shot: checks the
   * receipt for a matching Transfer and the current confirmation count.
   */
  async verify (
    intent: VerifierIntent,
    txHash: string,
    requiredConfirmations = 1
  ): Promise<PaymentConfirmation> {
    const provider = await this.#getProvider()
    let receipt: EvmReceipt | null
    try {
      receipt = await provider.getTransactionReceipt(txHash)
    } catch {
      return { status: 'pending', txHash, reason: 'rpc_unreachable' }
    }
    if (!receipt) return { status: 'pending', txHash, reason: 'not_mined' }
    if (receipt.status === 0) return { status: 'failed', txHash, reason: 'reverted' }

    const match = matchTransfer(receipt.logs, intent)
    if (!match) return { status: 'failed', txHash, reason: 'no_matching_transfer' }

    let head: number
    try { head = await provider.getBlockNumber() } catch {
      return { status: 'pending', txHash, valueBase: match.value.toString(), reason: 'rpc_unreachable' }
    }
    const confirmations = head - receipt.blockNumber + 1
    const base = {
      txHash, blockNumber: receipt.blockNumber, confirmations: Math.max(0, confirmations),
      valueBase: match.value.toString(), fromAddress: match.from
    }
    if (confirmations < requiredConfirmations) return { status: 'pending', ...base, reason: 'awaiting_confirmations' }
    return { status: 'confirmed', ...base, receivedAt: Date.now() }
  }

  /**
   * Watch for an incoming payment matching the intent (no tx hash known yet):
   * polls `getLogs` for a Transfer to the recipient ≥ amount, then waits for
   * confirmations. Resolves `confirmed`, or `pending` (reason `timeout`) if the
   * window elapses.
   */
  async watch (intent: VerifierIntent, options: WatchOptions = {}): Promise<PaymentConfirmation> {
    const provider = await this.#getProvider()
    const requiredConfirmations = options.requiredConfirmations ?? 1
    const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000
    const pollIntervalMs = options.pollIntervalMs ?? 5000
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const now = options.now ?? (() => Date.now())

    const start = now()
    let fromBlock = options.fromBlock
    if (fromBlock === undefined) {
      try { fromBlock = Math.max(0, (await provider.getBlockNumber()) - 5000) } catch { fromBlock = 0 }
    }

    for (;;) {
      let logs: readonly EvmLog[] = []
      try {
        logs = await provider.getLogs({
          address: intent.tokenAddress,
          topics: [TRANSFER_TOPIC, null, '0x' + getAddress(intent.receivingAddress).slice(2).toLowerCase().padStart(64, '0')],
          fromBlock,
          toBlock: 'latest'
        })
      } catch { /* transient — retry next tick */ }

      const match = matchTransfer(logs, intent)
      if (match && match.log.transactionHash) {
        const confirmation = await this.verify(intent, match.log.transactionHash, requiredConfirmations)
        if (confirmation.status === 'confirmed' || confirmation.status === 'failed') return confirmation
      }
      if (now() - start >= timeoutMs) return { status: 'pending', reason: 'timeout' }
      await sleep(pollIntervalMs)
    }
  }
}
