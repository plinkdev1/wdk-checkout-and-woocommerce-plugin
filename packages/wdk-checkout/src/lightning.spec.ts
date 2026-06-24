/**
 * Unit tests for the Lightning module: sats conversion, status normalization,
 * the generic REST client (mocked fetch + custom parsers), and deterministic
 * polling (injected sleep/now).
 */
import { describe, it, expect, vi } from 'vitest'
import {
  btcToSats, satsForFiat, formatSats, normalizeLightningStatus,
  createLightningClient, pollInvoice,
  createSparkLightningProvider, normalizeSparkReceiveStatus,
  type LightningProvider, type LightningInvoiceStatus, type SparkLightningAccount
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

describe('normalizeSparkReceiveStatus', () => {
  it('treats a preimage / transfer / received-style status as paid', () => {
    expect(normalizeSparkReceiveStatus({ status: 'LIGHTNING_PAYMENT_RECEIVED' })).toBe('paid')
    expect(normalizeSparkReceiveStatus({ status: 'TRANSFER_COMPLETED' })).toBe('paid')
    expect(normalizeSparkReceiveStatus({ paymentPreimage: 'deadbeef' })).toBe('paid')
    expect(normalizeSparkReceiveStatus({ transfer: { id: 't1' } })).toBe('paid')
  })
  it('maps expired/cancelled and defaults to pending', () => {
    expect(normalizeSparkReceiveStatus({ status: 'INVOICE_EXPIRED' })).toBe('expired')
    expect(normalizeSparkReceiveStatus({ status: 'CANCELLED' })).toBe('expired')
    expect(normalizeSparkReceiveStatus({ status: 'INVOICE_CREATED' })).toBe('pending')
    expect(normalizeSparkReceiveStatus({})).toBe('pending')
  })
})

describe('createSparkLightningProvider', () => {
  it('adapts a Spark account: createInvoice extracts id + BOLT11, getInvoiceStatus maps status', async () => {
    const account: SparkLightningAccount = {
      createLightningInvoice: vi.fn(async ({ amountSats, memo }) => ({
        id: 'req_1',
        invoice: { encodedInvoice: 'lnbc500n1pexample' },
        amountSats,
        memo
      })),
      getLightningReceiveRequest: vi.fn(async (id: string) => ({ id, status: 'LIGHTNING_PAYMENT_RECEIVED', paymentPreimage: 'beef' }))
    }
    const ln = createSparkLightningProvider(account)

    const inv = await ln.createInvoice({ amountSats: 500, memo: 'order #7' })
    expect(inv.id).toBe('req_1')
    expect(inv.bolt11).toBe('lnbc500n1pexample')
    expect(inv.amountSats).toBe(500)
    expect(inv.expiresAt).toBeGreaterThan(inv.createdAt)
    expect(account.createLightningInvoice).toHaveBeenCalledWith(expect.objectContaining({ amountSats: 500, memo: 'order #7' }))

    const st = await ln.getInvoiceStatus('req_1')
    expect(st.status).toBe('paid')
    expect(st.preimage).toBe('beef')
  })

  it('throws when the receive request has no BOLT11', async () => {
    const account: SparkLightningAccount = {
      createLightningInvoice: vi.fn(async () => ({ id: 'req_2' })), // no encodedInvoice
      getLightningReceiveRequest: vi.fn(async (id: string) => ({ id, status: 'INVOICE_CREATED' }))
    }
    const ln = createSparkLightningProvider(account)
    await expect(ln.createInvoice({ amountSats: 100 })).rejects.toThrow(/encodedInvoice|BOLT11/)
  })

  it('honors a custom mapStatus override', async () => {
    const account: SparkLightningAccount = {
      createLightningInvoice: vi.fn(async () => ({ id: 'r', invoice: { encodedInvoice: 'lnbc1' } })),
      getLightningReceiveRequest: vi.fn(async (id: string) => ({ id, status: 'WHATEVER' }))
    }
    const ln = createSparkLightningProvider(account, { mapStatus: () => 'paid' })
    expect((await ln.getInvoiceStatus('r')).status).toBe('paid')
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
