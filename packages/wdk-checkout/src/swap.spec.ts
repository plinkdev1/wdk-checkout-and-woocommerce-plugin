/**
 * Unit tests for swap-to-settle: exact (BigInt) slippage math and plan building,
 * including quote-expiry / validation paths and a mocked quote provider.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  applySlippageUp, applySlippageDown, planSwapToSettle, quoteAndPlanSwapToSettle,
  type SwapQuote, type SwapQuoteProvider
} from './swap.js'

const PAY = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' // WETH
const SETTLE = '0xdAC17F958D2ee523a2206206994597C13D831ec7' // USDt

function quote (over: Partial<SwapQuote> = {}): SwapQuote {
  return { payToken: PAY, settleToken: SETTLE, settleAmountBase: '100000000', quotedPayAmountBase: '40000000000000000', ...over }
}

describe('slippage math (exact, BigInt)', () => {
  it('rounds the input cap UP', () => {
    expect(applySlippageUp('1000000', 50)).toBe('1005000') // +0.5%
    expect(applySlippageUp('1000000', 0)).toBe('1000000')
    // ceil: 1 * 1.005 = 1.005 -> 2 (never under-cap)
    expect(applySlippageUp('1', 50)).toBe('2')
  })

  it('rounds an output floor DOWN', () => {
    expect(applySlippageDown('1000000', 50)).toBe('995000') // -0.5%
    expect(applySlippageDown('999', 50)).toBe('994') // floor(999*0.995)=994
  })

  it('rejects bad inputs', () => {
    expect(() => applySlippageUp('1.5', 50)).toThrow()
    expect(() => applySlippageUp('1000', -1)).toThrow()
  })
})

describe('planSwapToSettle', () => {
  it('pins exact output and caps the input by slippage', () => {
    const p = planSwapToSettle({ quote: quote(), chainId: 1, slippageBps: 50, now: 1_000_000 })
    expect(p.settleAmountBase).toBe('100000000')   // merchant gets exactly the order amount
    expect(p.minReceiveBase).toBe('100000000')
    expect(p.maxPayAmountBase).toBe('40200000000000000') // 0.04 WETH +0.5%
    expect(p.deadline).toBe(1_000_000 + 600)
    expect(p.chainId).toBe(1)
  })

  it('honors a custom deadline and passes the route through', () => {
    const p = planSwapToSettle({ quote: quote({ route: 'velora:0xabc' }), chainId: 137, slippageBps: 100, deadlineSeconds: 120, now: 5_000 })
    expect(p.deadline).toBe(5_120)
    expect(p.route).toBe('velora:0xabc')
    expect(p.maxPayAmountBase).toBe('40400000000000000') // +1%
  })

  it('rejects an expired quote and a zero output', () => {
    expect(() => planSwapToSettle({ quote: quote({ expiresAt: 999 }), chainId: 1, slippageBps: 50, now: 1000 })).toThrow(/expired/)
    expect(() => planSwapToSettle({ quote: quote({ settleAmountBase: '0' }), chainId: 1, slippageBps: 50, now: 1000 })).toThrow()
  })
})

describe('quoteAndPlanSwapToSettle', () => {
  it('calls the provider for an exact-output quote, then plans', async () => {
    const provider: SwapQuoteProvider = {
      quoteExactOutput: vi.fn(async (a) => {
        expect(a.settleAmountBase).toBe('100000000')
        expect(a.payToken).toBe(PAY)
        return quote()
      })
    }
    const p = await quoteAndPlanSwapToSettle({
      provider, payToken: PAY, settleToken: SETTLE, settleAmountBase: '100000000',
      chainId: 1, slippageBps: 50, now: 2_000
    })
    expect(provider.quoteExactOutput).toHaveBeenCalledOnce()
    expect(p.maxPayAmountBase).toBe('40200000000000000')
    expect(p.deadline).toBe(2_600)
  })
})
