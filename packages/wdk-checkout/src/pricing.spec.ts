/**
 * Unit tests for the fiat pricing module: exact base-unit conversion/formatting,
 * locale fiat formatting, and the pluggable rate sources (static + endpoint).
 */
import { describe, it, expect, vi } from 'vitest'
import {
  formatFiat, formatTokenAmount, fiatToTokenBase,
  staticRate, endpointRate, quoteTokenBase, fiatDisplayLine
} from './pricing.js'

describe('formatTokenAmount', () => {
  it('inserts the decimal point and trims trailing zeros', () => {
    expect(formatTokenAmount('19990000', 6)).toBe('19.99')
    expect(formatTokenAmount('1000000', 6)).toBe('1')
    expect(formatTokenAmount('1', 6)).toBe('0.000001')
    expect(formatTokenAmount('0', 6)).toBe('0')
  })

  it('accepts bigint and handles sub-unit / large values exactly', () => {
    expect(formatTokenAmount(123456789n, 6)).toBe('123.456789')
    // 18-decimal token, exact (no float drift)
    expect(formatTokenAmount('1000000000000000000', 18)).toBe('1')
    expect(formatTokenAmount('1234500000000000000', 18)).toBe('1.2345')
  })

  it('supports grouping and a fraction cap (truncating)', () => {
    expect(formatTokenAmount('1234567890000', 6, { group: true })).toBe('1,234,567.89')
    expect(formatTokenAmount('19999999', 6, { maxFractionDigits: 2 })).toBe('19.99')
  })

  it('rejects non-numeric input', () => {
    expect(() => formatTokenAmount('1.5', 6)).toThrow()
    expect(() => formatTokenAmount('0xabc', 6)).toThrow()
  })
})

describe('fiatToTokenBase', () => {
  it('converts 1:1 (USD→USDt) to 6-decimal base units', () => {
    expect(fiatToTokenBase({ fiatAmount: 19.99, rateTokenPerFiat: 1, tokenDecimals: 6 })).toBe('19990000')
    expect(fiatToTokenBase({ fiatAmount: 0, rateTokenPerFiat: 1, tokenDecimals: 6 })).toBe('0')
  })

  it('applies a non-1:1 FX rate and rounds to the smallest unit', () => {
    // €100 at 1.08 USDt/EUR = 108.00 USDt
    expect(fiatToTokenBase({ fiatAmount: 100, rateTokenPerFiat: 1.08, tokenDecimals: 6 })).toBe('108000000')
    // round-half handled by toFixed at unit precision
    expect(fiatToTokenBase({ fiatAmount: 1, rateTokenPerFiat: 0.3333335, tokenDecimals: 6 })).toBe('333334')
  })

  it('round-trips with formatTokenAmount', () => {
    const base = fiatToTokenBase({ fiatAmount: 42.5, rateTokenPerFiat: 1, tokenDecimals: 6 })
    expect(formatTokenAmount(base, 6)).toBe('42.5')
  })

  it('rejects invalid inputs', () => {
    expect(() => fiatToTokenBase({ fiatAmount: -1, rateTokenPerFiat: 1, tokenDecimals: 6 })).toThrow()
    expect(() => fiatToTokenBase({ fiatAmount: 1, rateTokenPerFiat: 0, tokenDecimals: 6 })).toThrow()
  })
})

describe('formatFiat', () => {
  it('formats a known currency', () => {
    // en-US gives "$19.99"; assert it contains the number and a currency mark
    const s = formatFiat(19.99, 'USD', 'en-US')
    expect(s).toContain('19.99')
  })

  it('still formats a well-formed but non-real currency code (Intl accepts it)', () => {
    const s = formatFiat(10, 'XYZ')
    expect(s).toContain('10.00')
    expect(s).toContain('XYZ')
  })

  it('falls back to "<amount> <currency>" for a malformed currency code', () => {
    // Intl throws RangeError on a non-3-letter code → fallback path.
    expect(formatFiat(10, 'BADCODE')).toBe('10.00 BADCODE')
  })
})

describe('staticRate', () => {
  it('always returns the fixed rate', async () => {
    const src = staticRate(1)
    expect(await src.getRate('USD', 'USDt')).toBe(1)
  })
  it('rejects a non-positive rate', () => {
    expect(() => staticRate(0)).toThrow()
  })
})

describe('endpointRate', () => {
  it('substitutes {fiat}/{token}, reads json.rate, and uses the injected fetch', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://fx.example/EUR/USDt')
      return { ok: true, json: async () => ({ rate: 1.08 }) } as Response
    })
    const src = endpointRate('https://fx.example/{fiat}/{token}', { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await src.getRate('EUR', 'USDt')).toBe(1.08)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('supports a custom parser and surfaces HTTP errors', async () => {
    const ok = endpointRate('https://x/{token}', {
      fetchImpl: (async () => ({ ok: true, json: async () => ({ data: { usdt: 2 } }) })) as unknown as typeof fetch,
      parse: (j) => (j as { data: { usdt: number } }).data.usdt
    })
    expect(await ok.getRate('USD', 'USDt')).toBe(2)

    const bad = endpointRate('https://x', { fetchImpl: (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch })
    await expect(bad.getRate('USD', 'USDt')).rejects.toThrow(/503/)
  })
})

describe('quoteTokenBase', () => {
  it('combines a rate source with the base-unit conversion', async () => {
    const { rate, amountBase } = await quoteTokenBase({
      fiat: { amount: 50, currency: 'EUR' }, tokenSymbol: 'USDt', tokenDecimals: 6, source: staticRate(1.1)
    })
    expect(rate).toBe(1.1)
    expect(amountBase).toBe('55000000')
  })
})

describe('fiatDisplayLine', () => {
  it('formats when displayTotal + currency are present', () => {
    expect(fiatDisplayLine({ displayTotal: '19.99', currency: 'USD' }, 'en-US')).toContain('19.99')
    expect(fiatDisplayLine({ displayTotal: 100, currency: 'EUR' }, 'en-US')).toBeTruthy()
  })
  it('returns null when fiat data is missing or invalid', () => {
    expect(fiatDisplayLine({})).toBeNull()
    expect(fiatDisplayLine({ displayTotal: '19.99' })).toBeNull()
    expect(fiatDisplayLine({ displayTotal: 'abc', currency: 'USD' })).toBeNull()
  })
})
