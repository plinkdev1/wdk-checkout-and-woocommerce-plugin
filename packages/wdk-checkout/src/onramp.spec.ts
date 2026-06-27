/**
 * Fiat on-ramp URL builder (Phase 4 item 9). Pure — locks the query shaping.
 */
import { describe, it, expect } from 'vitest'
import { buildOnrampUrl } from './onramp.js'

describe('buildOnrampUrl', () => {
  it('defaults to MoonPay and pre-fills currency + amount + address', () => {
    const url = buildOnrampUrl(
      { apiKey: 'pk_test_123' },
      { currencyCode: 'USDt', walletAddress: '0xabc', fiatAmount: '19.99', fiatCurrency: 'USD' },
    )
    expect(url.startsWith('https://buy.moonpay.com?')).toBe(true)
    const q = new URL(url).searchParams
    expect(q.get('apiKey')).toBe('pk_test_123')
    expect(q.get('currencyCode')).toBe('usdt') // lowercased
    expect(q.get('walletAddress')).toBe('0xabc')
    expect(q.get('baseCurrencyAmount')).toBe('19.99')
    expect(q.get('baseCurrencyCode')).toBe('usd')
  })

  it('honors a custom provider base URL + extra params', () => {
    const url = buildOnrampUrl(
      { baseUrl: 'https://pay.example/buy/', currencyCode: 'usdc', params: { theme: 'dark' } },
      { walletAddress: '0x1' },
    )
    expect(url.startsWith('https://pay.example/buy?')).toBe(true) // trailing slash trimmed
    expect(new URL(url).searchParams.get('theme')).toBe('dark')
  })

  it('runs the result through signUrl (production server-signing seam)', () => {
    const url = buildOnrampUrl(
      { apiKey: 'pk', signUrl: (u) => `https://store/sign?u=${encodeURIComponent(u)}` },
      { currencyCode: 'usdt' },
    )
    expect(url.startsWith('https://store/sign?u=')).toBe(true)
  })

  it('omits empty fields cleanly', () => {
    const url = buildOnrampUrl({}, {})
    expect(url).toBe('https://buy.moonpay.com')
  })
})
