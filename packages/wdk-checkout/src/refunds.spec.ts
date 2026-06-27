/**
 * Refunds & partial captures (Phase 4 item 7) — descriptor validation + calldata.
 */
import { describe, it, expect } from 'vitest'
import { buildRefund, refundTransferCalldata } from './refunds.js'

const TOKEN = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const PAYER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

describe('buildRefund', () => {
  it('builds a full refund (partial=false) at the captured amount', () => {
    const r = buildRefund({ token: TOKEN, payer: PAYER, amountBase: '19990000', capturedBase: '19990000', chainId: 1, orderKey: 'k' })
    expect(r).toMatchObject({ token: TOKEN, to: PAYER, amountBase: '19990000', chainId: 1, partial: false })
  })

  it('marks a smaller amount as a partial refund', () => {
    const r = buildRefund({ token: TOKEN, payer: PAYER, amountBase: 5_000_000n, capturedBase: 19_990_000n, chainId: 137, orderKey: 'k', reason: 'one item' })
    expect(r.partial).toBe(true)
    expect(r.reason).toBe('one item')
  })

  it('rejects zero, over-capture, bad addresses, and bad chainId', () => {
    expect(() => buildRefund({ token: TOKEN, payer: PAYER, amountBase: 0n, capturedBase: 10n, chainId: 1, orderKey: 'k' })).toThrow(/greater than zero/)
    expect(() => buildRefund({ token: TOKEN, payer: PAYER, amountBase: 11n, capturedBase: 10n, chainId: 1, orderKey: 'k' })).toThrow(/exceeds/)
    expect(() => buildRefund({ token: 'nope', payer: PAYER, amountBase: 1n, capturedBase: 10n, chainId: 1, orderKey: 'k' })).toThrow(/token address/)
    expect(() => buildRefund({ token: TOKEN, payer: PAYER, amountBase: 1n, capturedBase: 10n, chainId: 0, orderKey: 'k' })).toThrow(/chainId/)
  })
})

describe('refundTransferCalldata', () => {
  it('encodes transfer(payer, amount) with the a9059cbb selector', () => {
    const data = refundTransferCalldata(PAYER, 19_990_000n)
    expect(data.startsWith('0xa9059cbb')).toBe(true)
    expect(data).toHaveLength(2 + 8 + 64 + 64)
    // address word (chars 10..74) decodes to the payer; amount word to the value
    const addrWord = data.slice(10, 10 + 64)
    const amtWord = data.slice(10 + 64)
    expect(BigInt('0x' + addrWord)).toBe(BigInt(PAYER))
    expect(BigInt('0x' + amtWord)).toBe(19_990_000n)
  })
})
