/**
 * Unit tests for the on-chain transfer verifier: pure log-matching + the
 * RPC-driven verifyTransfer (mocked fetch) across confirmed/pending/failed.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  TRANSFER_TOPIC, normalizeAddress, topicToAddress, hexToBigInt,
  findMatchingTransfer, verifyTransfer
} from './verify.js'

const TOKEN = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const TX = '0x' + 'a'.repeat(64)

const toTopic = (addr: string) => '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase()
const transferLog = (token: string, to: string, valueHex: string) => ({
  address: token,
  topics: [TRANSFER_TOPIC, toTopic('0x' + '1'.repeat(40)), toTopic(to)],
  data: valueHex,
})

describe('pure helpers', () => {
  it('normalizeAddress lowercases valid addresses and rejects junk', () => {
    expect(normalizeAddress(TOKEN)).toBe(TOKEN.toLowerCase())
    expect(normalizeAddress('0x123')).toBeNull()
  })
  it('topicToAddress takes the last 20 bytes', () => {
    expect(topicToAddress(toTopic(TO))).toBe(TO.toLowerCase())
    expect(topicToAddress('0x00')).toBeNull()
  })
  it('hexToBigInt parses uint256 exactly', () => {
    expect(hexToBigInt('0x1312d00')).toBe(20000000n)
    expect(hexToBigInt('0x')).toBe(0n)
    expect(hexToBigInt('nope')).toBe(0n)
  })
})

describe('findMatchingTransfer', () => {
  it('matches token + recipient + value >= min', () => {
    const logs = [transferLog(TOKEN, TO, '0x1312d00')] // 20,000,000 base units
    expect(findMatchingTransfer(logs, TOKEN, TO, 19_990_000n)).toEqual({ valueBase: '20000000' })
  })
  it('rejects a wrong emitter, wrong recipient, or under-payment', () => {
    expect(findMatchingTransfer([transferLog('0x' + 'b'.repeat(40), TO, '0x1312d00')], TOKEN, TO, 1n)).toBeNull()
    expect(findMatchingTransfer([transferLog(TOKEN, '0x' + 'c'.repeat(40), '0x1312d00')], TOKEN, TO, 1n)).toBeNull()
    expect(findMatchingTransfer([transferLog(TOKEN, TO, '0x1')], TOKEN, TO, 19_990_000n)).toBeNull()
  })
  it('ignores non-Transfer logs', () => {
    const noise = { address: TOKEN, topics: ['0xdead'], data: '0x1312d00' }
    expect(findMatchingTransfer([noise], TOKEN, TO, 1n)).toBeNull()
  })
})

function mockRpc (handlers: Record<string, unknown>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { method: string }
    const result = handlers[body.method]
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) } as unknown as Response
  })
}

describe('verifyTransfer', () => {
  const base = { rpcUrl: 'https://rpc', txHash: TX, token: TOKEN, to: TO, minAmountBase: 19_990_000n }

  it('confirms a valid transfer with enough confirmations', async () => {
    const fetchImpl = mockRpc({
      eth_getTransactionReceipt: { status: '0x1', blockNumber: '0x10', logs: [transferLog(TOKEN, TO, '0x1312d00')] },
      eth_blockNumber: '0x12', // 18 - 16 + 1 = 3 confs
    })
    const r = await verifyTransfer({ ...base, confirmations: 2, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.status).toBe('confirmed')
    expect(r.confirmations).toBe(3)
    expect(r.valueBase).toBe('20000000')
  })

  it('is pending when the receipt is not yet available', async () => {
    const fetchImpl = mockRpc({ eth_getTransactionReceipt: null })
    const r = await verifyTransfer({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.status).toBe('pending')
  })

  it('is pending when confirmations are below the threshold', async () => {
    const fetchImpl = mockRpc({
      eth_getTransactionReceipt: { status: '0x1', blockNumber: '0x10', logs: [transferLog(TOKEN, TO, '0x1312d00')] },
      eth_blockNumber: '0x10', // exactly 1 conf
    })
    const r = await verifyTransfer({ ...base, confirmations: 5, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.status).toBe('pending')
    expect(r.confirmations).toBe(1)
  })

  it('fails a reverted tx and a tx with no matching transfer', async () => {
    const reverted = mockRpc({ eth_getTransactionReceipt: { status: '0x0', logs: [] } })
    expect((await verifyTransfer({ ...base, fetchImpl: reverted as unknown as typeof fetch })).status).toBe('failed')

    const noMatch = mockRpc({ eth_getTransactionReceipt: { status: '0x1', blockNumber: '0x10', logs: [] } })
    expect((await verifyTransfer({ ...base, fetchImpl: noMatch as unknown as typeof fetch })).status).toBe('failed')
  })

  it('treats a transport error as pending (transient)', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network') })
    const r = await verifyTransfer({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.status).toBe('pending')
  })

  it('rejects a malformed tx hash without calling the RPC', async () => {
    const fetchImpl = vi.fn()
    const r = await verifyTransfer({ ...base, txHash: '0xnope', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.status).toBe('failed')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
