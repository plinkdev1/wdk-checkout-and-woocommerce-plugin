/**
 * Unit tests for the subscriptions module: schedule windows/nonces, due-charge
 * selection, and round-trip signing/verification with a real ethers Wallet.
 */
import { describe, it, expect } from 'vitest'
import { Wallet } from 'ethers'
import {
  buildSubscriptionSchedule, isChargeClaimable, chargeDueAt,
  subscriptionDomain, chargeTypedData, verifyChargeSignature,
  type SubscriptionPlan
} from './subscriptions.js'

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // Hardhat #0 (public)
const PAYER = new Wallet(KEY)
const MERCHANT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const TOKEN = '0xdAC17F958D2ee523a2206206994597C13D831ec7' // USDt mainnet

const MONTH = 2592000

function plan (over: Partial<SubscriptionPlan> = {}): SubscriptionPlan {
  return {
    from: PAYER.address, to: MERCHANT, token: TOKEN, chainId: 1,
    amountBase: '10000000', periods: 3, intervalSeconds: MONTH, startAt: 1_000_000, ...over
  }
}

describe('buildSubscriptionSchedule', () => {
  it('creates one charge per period with contiguous, non-overlapping windows', () => {
    const s = buildSubscriptionSchedule(plan())
    expect(s.charges).toHaveLength(3)
    expect(s.charges[0].validAfter).toBe('1000000')
    expect(s.charges[0].validBefore).toBe(String(1_000_000 + MONTH))
    // next period opens exactly when the previous closes
    expect(s.charges[1].validAfter).toBe(s.charges[0].validBefore)
    expect(s.charges[2].validAfter).toBe(String(1_000_000 + 2 * MONTH))
    expect(s.charges.every((c) => c.value === '10000000')).toBe(true)
  })

  it('honors a custom (shorter) claim window', () => {
    const s = buildSubscriptionSchedule(plan({ windowSeconds: 86400 }))
    expect(s.charges[0].validBefore).toBe(String(1_000_000 + 86400))
    // a gap now exists before the next period opens
    expect(Number(s.charges[1].validAfter)).toBeGreaterThan(Number(s.charges[0].validBefore))
  })

  it('gives every period a distinct, deterministic bytes32 nonce', () => {
    const a = buildSubscriptionSchedule(plan({ nonceSeed: 'order-42' }))
    const b = buildSubscriptionSchedule(plan({ nonceSeed: 'order-42' }))
    const nonces = a.charges.map((c) => c.nonce)
    expect(new Set(nonces).size).toBe(3)
    for (const n of nonces) expect(n).toMatch(/^0x[0-9a-f]{64}$/)
    // deterministic: same plan → same nonces
    expect(b.charges.map((c) => c.nonce)).toEqual(nonces)
    // different seed → different nonces
    const c = buildSubscriptionSchedule(plan({ nonceSeed: 'order-99' }))
    expect(c.charges[0].nonce).not.toBe(a.charges[0].nonce)
  })

  it('normalizes addresses to checksum form', () => {
    const s = buildSubscriptionSchedule(plan({ to: MERCHANT.toLowerCase() }))
    expect(s.charges[0].to).toBe(MERCHANT)
  })

  it('rejects invalid plans', () => {
    expect(() => buildSubscriptionSchedule(plan({ periods: 0 }))).toThrow()
    expect(() => buildSubscriptionSchedule(plan({ intervalSeconds: 0 }))).toThrow()
    expect(() => buildSubscriptionSchedule(plan({ amountBase: '0' }))).toThrow()
    expect(() => buildSubscriptionSchedule(plan({ amountBase: '1.5' }))).toThrow()
  })
})

describe('claim windows', () => {
  const s = buildSubscriptionSchedule(plan())

  it('isChargeClaimable respects [validAfter, validBefore)', () => {
    expect(isChargeClaimable(s.charges[0], 1_000_000)).toBe(true)
    expect(isChargeClaimable(s.charges[0], 999_999)).toBe(false) // before
    expect(isChargeClaimable(s.charges[0], 1_000_000 + MONTH)).toBe(false) // == validBefore is closed
  })

  it('chargeDueAt picks the period whose window contains now', () => {
    expect(chargeDueAt(s, 1_000_000)?.index).toBe(0)
    expect(chargeDueAt(s, 1_000_000 + MONTH + 10)?.index).toBe(1)
    expect(chargeDueAt(s, 1_000_000 + 3 * MONTH + 10)).toBeNull() // after the last period
  })
})

describe('signing + verification', () => {
  it('verifies a real wallet signature over a charge and rejects tampering', async () => {
    const s = buildSubscriptionSchedule(plan())
    const domain = subscriptionDomain({ name: 'Tether USD', version: '2', chainId: 1, token: TOKEN })
    const charge = s.charges[0]
    const { types, message } = chargeTypedData(charge, domain)

    const signature = await PAYER.signTypedData(domain, types, message)
    expect(verifyChargeSignature(charge, signature, domain)).toBe(true)

    // tampering with the amount invalidates the signature
    const tampered = { ...charge, value: '999999999' }
    expect(verifyChargeSignature(tampered, signature, domain)).toBe(false)

    // a signature for period 0 does not authorize period 1 (different nonce/window)
    expect(verifyChargeSignature(s.charges[1], signature, domain)).toBe(false)
  })
})
