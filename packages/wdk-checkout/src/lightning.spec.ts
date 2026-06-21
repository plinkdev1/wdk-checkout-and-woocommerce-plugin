/**
 * Unit tests for the Lightning module: sats conversion, status normalization,
 * the generic REST client (mocked fetch + custom parsers), and deterministic
 * polling (injected sleep/now).
 */
import { describe, it, expect, vi } from 'vitest'
import {
  btcToSats, satsForFiat, formatSats, normalizeLightningStatus,
  createLightningClient, pollInvoice,
  type LightningProvider, type LightningInvoiceStatus
} from './lightning.js'

describe('conversions', () => {
  it('btcToSats and satsForFiat round to integer sats', () => {
    expect(btcToSats(1)).toBe(100_000_000)
    expect(btcToSats(0.00001234)).toBe(1234)
    // $50 at $50,000/BTC = 0.001 BTC = 100,000 sats
    expect(satsForFiat({ fiatAmount: 50, btcPriceFiat: 50_000 })).toBe(100_000)
  })

  it('formatSats is human-friendly', () => {
    expect(formatSats(1234)).toBe('1,234 sats')
  })

  it('rejects bad inputs', () => {
    expect(() => btcToSats(-1)).toThrow()
    expect(() => satsForFiat({ fiatAmount: 1, btcPriceFiat: 0 })).toThrow()
  })
})

describe('normalizeLightningStatus', () => {
  it('maps backend variants to pending/paid/expired', () => {
    expect(normalizeLightningStatus('settled')).toBe('paid')
    expect(normalizeLightningStatus('SUCCESS')).toBe('paid')
    expect(normalizeLightningStatus(true)).toBe('paid')
    expect(normalizeLightningStatus('expired')).toBe('expired')
    expect(normalizeLightningStatus('cancelled')).toBe('expired')
    expect(normalizeLightningStatus('pending')).toBe('pending')
    expect(normalizeLightningStatus(undefined)).toBe('pending')
  })
})

describe('createLightningClient', () => {
  it('POSTs to create and parses common field names', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://ln.example/invoices')
      expect(init?.method).toBe('POST')
      return { ok: true, json: async () => ({ payment_hash: 'abc', payment_request: 'lnbc1...', amount_sats: 100, expires_at: 2000 }) } as Response
    })
    const client = createLightningClient({ baseUrl: 'https://ln.example/', fetchImpl: fetchImpl as unknown as typeof fetch })
    const inv = await client.createInvoice({ amountSats: 100, memo: 'order #1' })
    expect(inv.id).toBe('abc')
    expect(inv.bolt11).toBe('lnbc1...')
    expect(inv.amountSats).toBe(100)
  })

  it('GETs status with auth headers and a custom status path/parser', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://ln.example/check/xyz')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer k')
      return { ok: true, json: async () => ({ id: 'xyz', state: 'COMPLETE' }) } as Response
    })
    const client = createLightningClient({
      baseUrl: 'https://ln.example',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      headers: { Authorization: 'Bearer k' },
      statusPath: (id) => `/check/${id}`
    })
    const st = await client.getInvoiceStatus('xyz')
    expect(st.status).toBe('paid')
  })

  it('surfaces HTTP errors', async () => {
    const client = createLightningClient({
      baseUrl: 'https://ln.example',
      fetchImpl: (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
    })
    await expect(client.createInvoice({ amountSats: 1 })).rejects.toThrow(/500/)
  })
})

describe('pollInvoice', () => {
  it('resolves when the invoice becomes paid (deterministic sleep)', async () => {
    const statuses: LightningInvoiceStatus[] = [
      { id: 'i', status: 'pending' },
      { id: 'i', status: 'pending' },
      { id: 'i', status: 'paid', paidAt: 123 }
    ]
    let call = 0
    const provider: LightningProvider = {
      createInvoice: vi.fn(),
      getInvoiceStatus: vi.fn(async () => statuses[Math.min(call++, statuses.length - 1)])
    }
    const updates: string[] = []
    const final = await pollInvoice({
      provider, id: 'i', intervalMs: 10, timeoutMs: 10_000,
      now: () => 0, sleep: async () => {}, onUpdate: (s) => updates.push(s.status)
    })
    expect(final.status).toBe('paid')
    expect(updates).toEqual(['pending', 'pending', 'paid'])
  })

  it('rejects on timeout', async () => {
    const provider: LightningProvider = {
      createInvoice: vi.fn(),
      getInvoiceStatus: vi.fn(async () => ({ id: 'i', status: 'pending' as const }))
    }
    let t = 0
    await expect(pollInvoice({
      provider, id: 'i', intervalMs: 1, timeoutMs: 5,
      now: () => (t += 10), sleep: async () => {}
    })).rejects.toThrow(/timed out/)
  })
})
