/**
 * Unit tests for the payment verifier: Transfer-log matching, one-shot verify
 * (confirmed / pending / reverted / no-match), and watch (poll → confirm, timeout).
 * A fake provider stands in for ethers so no network is touched.
 */
import { describe, it, expect, vi } from 'vitest'
import { PaymentVerifier, matchTransfer, TRANSFER_TOPIC, type EvmLog, type EvmReadProvider, type VerifierIntent } from './verifier.js'

const TOKEN = '0xdAC17F958D2ee523a2206206994597C13D831ec7' // USDt
const MERCHANT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const PAYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const HASH = '0x' + 'ab'.repeat(32)

const intent: VerifierIntent = { tokenAddress: TOKEN, receivingAddress: MERCHANT, amountBase: '100000000' } // 100 USDt

function topicAddr (addr: string): string {
  return '0x' + addr.slice(2).toLowerCase().padStart(64, '0')
}
function valueData (v: bigint): string {
  return '0x' + v.toString(16).padStart(64, '0')
}
function transferLog (over: Partial<EvmLog> & { value?: bigint } = {}): EvmLog {
  const value = over.value ?? 100_000_000n
  return {
    address: over.address ?? TOKEN,
    topics: over.topics ?? [TRANSFER_TOPIC, topicAddr(PAYER), topicAddr(MERCHANT)],
    data: over.data ?? valueData(value),
    blockNumber: over.blockNumber ?? 100,
    transactionHash: over.transactionHash ?? HASH
  }
}

function provider (over: Partial<EvmReadProvider> = {}): EvmReadProvider {
  return {
    getTransactionReceipt: vi.fn(async () => ({ status: 1, blockNumber: 100, logs: [transferLog()], transactionHash: HASH })),
    getBlockNumber: vi.fn(async () => 105),
    getLogs: vi.fn(async () => []),
    ...over
  }
}

describe('matchTransfer', () => {
  it('matches a Transfer to the recipient with value ≥ amount', () => {
    const m = matchTransfer([transferLog()], intent)
    expect(m?.value).toBe(100_000_000n)
    expect(m?.from.toLowerCase()).toBe(PAYER.toLowerCase())
  })
  it('rejects wrong token, wrong recipient, or short amount', () => {
    expect(matchTransfer([transferLog({ address: '0x' + '11'.repeat(20) })], intent)).toBeNull()
    expect(matchTransfer([transferLog({ topics: [TRANSFER_TOPIC, topicAddr(PAYER), topicAddr(PAYER)] })], intent)).toBeNull()
    expect(matchTransfer([transferLog({ value: 99_999_999n })], intent)).toBeNull()
  })
})

describe('verify', () => {
  it('confirms with enough confirmations', async () => {
    const v = new PaymentVerifier({ provider: provider() })
    const r = await v.verify(intent, HASH, 3)
    expect(r.status).toBe('confirmed')
    expect(r.confirmations).toBe(6) // 105 - 100 + 1
    expect(r.valueBase).toBe('100000000')
    expect(r.fromAddress?.toLowerCase()).toBe(PAYER.toLowerCase())
  })

  it('is pending while confirmations are insufficient', async () => {
    const v = new PaymentVerifier({ provider: provider({ getBlockNumber: vi.fn(async () => 100) }) })
    const r = await v.verify(intent, HASH, 5)
    expect(r.status).toBe('pending')
    expect(r.reason).toBe('awaiting_confirmations')
    expect(r.confirmations).toBe(1)
  })

  it('is pending when the tx is not mined yet', async () => {
    const v = new PaymentVerifier({ provider: provider({ getTransactionReceipt: vi.fn(async () => null) }) })
    expect((await v.verify(intent, HASH)).reason).toBe('not_mined')
  })

  it('fails on a reverted tx', async () => {
    const v = new PaymentVerifier({ provider: provider({ getTransactionReceipt: vi.fn(async () => ({ status: 0, blockNumber: 100, logs: [] })) }) })
    expect((await v.verify(intent, HASH)).status).toBe('failed')
  })

  it('fails when no matching transfer is present', async () => {
    const v = new PaymentVerifier({ provider: provider({ getTransactionReceipt: vi.fn(async () => ({ status: 1, blockNumber: 100, logs: [transferLog({ value: 1n })] })) }) })
    const r = await v.verify(intent, HASH)
    expect(r.status).toBe('failed')
    expect(r.reason).toBe('no_matching_transfer')
  })
})

describe('watch', () => {
  it('polls getLogs, finds the transfer, and confirms', async () => {
    const p = provider({ getLogs: vi.fn(async () => [transferLog()]) })
    const v = new PaymentVerifier({ provider: p })
    const r = await v.watch(intent, { requiredConfirmations: 3, fromBlock: 0, sleep: async () => {}, now: () => 0 })
    expect(r.status).toBe('confirmed')
    expect(p.getLogs).toHaveBeenCalled()
  })

  it('resolves pending/timeout when nothing arrives', async () => {
    let t = 0
    const v = new PaymentVerifier({ provider: provider() }) // getLogs → []
    const r = await v.watch(intent, { timeoutMs: 5, pollIntervalMs: 1, fromBlock: 0, sleep: async () => {}, now: () => (t += 10) })
    expect(r.status).toBe('pending')
    expect(r.reason).toBe('timeout')
  })

  it('requires a provider or rpcUrl', () => {
    expect(() => new PaymentVerifier({})).toThrow()
  })
})
