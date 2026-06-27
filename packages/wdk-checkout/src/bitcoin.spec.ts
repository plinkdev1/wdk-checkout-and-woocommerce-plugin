/**
 * Unit tests for the on-chain Bitcoin rail: sats↔BTC formatting, BIP-21 URIs,
 * address sources, the pure tx-evaluation, the Esplora client (mocked fetch),
 * and deterministic polling (injected sleep/now).
 */
import { describe, it, expect, vi } from 'vitest'
import {
  satsToBtcString, buildBip21Uri,
  staticAddressSource, accountAddressSource, createBitcoinPaymentRequest,
  sumOutputsToAddress, evaluateAddressTxs, createEsploraWatcher, watchAddress,
  type BitcoinWatcher, type BitcoinPaymentStatus
} from './bitcoin.js'

const ADDR = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

describe('satsToBtcString', () => {
  it('renders exact BTC with trailing zeros trimmed', () => {
    expect(satsToBtcString(100_000_000)).toBe('1')
    expect(satsToBtcString(1234)).toBe('0.00001234')
    expect(satsToBtcString(150_000_000)).toBe('1.5')
    expect(satsToBtcString(0)).toBe('0')
  })
})

describe('buildBip21Uri', () => {
  it('encodes the amount in BTC and URI-encodes label/message', () => {
    expect(buildBip21Uri({ address: ADDR, amountSats: 1234 })).toBe(`bitcoin:${ADDR}?amount=0.00001234`)
    const uri = buildBip21Uri({ address: ADDR, amountSats: 100_000_000, label: 'Acme Co', message: 'Order #7' })
    expect(uri).toBe(`bitcoin:${ADDR}?amount=1&label=Acme%20Co&message=Order%20%237`)
  })

  it('omits amount when zero and rejects an empty address', () => {
    expect(buildBip21Uri({ address: ADDR, amountSats: 0 })).toBe(`bitcoin:${ADDR}`)
    expect(() => buildBip21Uri({ address: '', amountSats: 1 })).toThrow()
  })
})

describe('address sources', () => {
  it('staticAddressSource returns the fixed address', async () => {
    const src = staticAddressSource(ADDR)
    expect(await src.nextAddress('order-1')).toBe(ADDR)
    expect(() => staticAddressSource('')).toThrow()
  })

  it('accountAddressSource adapts whichever receive method exists', async () => {
    expect(await accountAddressSource({ getReceiveAddress: () => ADDR }).nextAddress('o')).toBe(ADDR)
    expect(await accountAddressSource({ getNewAddress: async () => ADDR }).nextAddress('o')).toBe(ADDR)
    expect(await accountAddressSource({ deriveAddress: (i) => `${ADDR}:${i}` }).nextAddress('o')).toBe(`${ADDR}:0`)
    expect(await accountAddressSource({ receiveAddress: ADDR }).nextAddress('o')).toBe(ADDR)
    await expect(accountAddressSource({}).nextAddress('o')).rejects.toThrow()
  })
})

describe('createBitcoinPaymentRequest', () => {
  it('assembles a request with a BIP-21 URI and a fixed expiry window', async () => {
    const req = await createBitcoinPaymentRequest({
      source: staticAddressSource(ADDR),
      orderRef: 'order-7',
      amountSats: 50_000,
      label: 'Acme',
      expirySeconds: 1800,
      now: () => 1_700_000_000_000
    })
    expect(req.address).toBe(ADDR)
    expect(req.amountSats).toBe(50_000)
    expect(req.uri).toBe(`bitcoin:${ADDR}?amount=0.0005&label=Acme`)
    expect(req.createdAt).toBe(1_700_000_000)
    expect(req.expiresAt).toBe(1_700_000_000 + 1800)
  })

  it('rejects a non-positive amount', async () => {
    await expect(createBitcoinPaymentRequest({ source: staticAddressSource(ADDR), orderRef: 'o', amountSats: 0 }))
      .rejects.toThrow()
  })
})

describe('sumOutputsToAddress', () => {
  it('sums only the outputs paying the target address', () => {
    const tx = { vout: [
      { scriptpubkey_address: ADDR, value: 30_000 },
      { scriptpubkey_address: 'bc1qother', value: 99 },
      { scriptpubkey_address: ADDR, value: 20_000 }
    ] }
    expect(sumOutputsToAddress(tx, ADDR)).toBe(50_000)
  })
})

describe('evaluateAddressTxs', () => {
  const txConfirmed = (sats: number, height: number) => ({
    txid: 'tx-conf', vout: [{ scriptpubkey_address: ADDR, value: sats }], status: { confirmed: true, block_height: height }
  })
  const txMempool = (sats: number) => ({
    txid: 'tx-mem', vout: [{ scriptpubkey_address: ADDR, value: sats }], status: { confirmed: false }
  })

  it('is paid when a qualifying tx has enough confirmations', () => {
    const s = evaluateAddressTxs([txConfirmed(50_000, 100)], ADDR, { minAmountSats: 50_000, requiredConfirmations: 1, tipHeight: 100 })
    expect(s).toEqual({ address: ADDR, status: 'paid', receivedSats: 50_000, confirmations: 1, txid: 'tx-conf' })
  })

  it('is pending when the qualifying tx is still in the mempool', () => {
    const s = evaluateAddressTxs([txMempool(50_000)], ADDR, { minAmountSats: 50_000, requiredConfirmations: 1, tipHeight: 100 })
    expect(s.status).toBe('pending')
    expect(s.confirmations).toBe(0)
    expect(s.txid).toBe('tx-mem')
  })

  it('is pending when confirmations are below the threshold', () => {
    const s = evaluateAddressTxs([txConfirmed(50_000, 100)], ADDR, { minAmountSats: 50_000, requiredConfirmations: 3, tipHeight: 100 })
    expect(s.status).toBe('pending')
    expect(s.confirmations).toBe(1)
  })

  it('ignores under-payments', () => {
    const s = evaluateAddressTxs([txConfirmed(10_000, 100)], ADDR, { minAmountSats: 50_000, requiredConfirmations: 1, tipHeight: 100 })
    expect(s).toEqual({ address: ADDR, status: 'pending', receivedSats: 0, confirmations: 0 })
  })

  it('prefers the most-confirmed qualifying tx', () => {
    const s = evaluateAddressTxs(
      [txMempool(50_000), txConfirmed(50_000, 94)],
      ADDR,
      { minAmountSats: 50_000, requiredConfirmations: 3, tipHeight: 100 }
    )
    expect(s.confirmations).toBe(7)
    expect(s.status).toBe('paid')
    expect(s.txid).toBe('tx-conf')
  })
})

describe('createEsploraWatcher', () => {
  it('queries the address txs + tip height and returns a normalized status', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.endsWith('/blocks/tip/height')) {
        return { ok: true, status: 200, json: async () => 100 } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => [{ txid: 't1', vout: [{ scriptpubkey_address: ADDR, value: 50_000 }], status: { confirmed: true, block_height: 99 } }]
      } as unknown as Response
    })
    const watcher = createEsploraWatcher({ baseUrl: 'https://mempool.space/api/', fetchImpl: fetchImpl as unknown as typeof fetch })
    const s = await watcher.getAddressStatus(ADDR, { minAmountSats: 50_000, requiredConfirmations: 2 })
    expect(s.status).toBe('paid')
    expect(s.confirmations).toBe(2)
    expect(s.txid).toBe('t1')
    expect(calls.some((u) => u.includes(`/address/${encodeURIComponent(ADDR)}/txs`))).toBe(true)
    expect(calls.some((u) => u.endsWith('/blocks/tip/height'))).toBe(true)
  })

  it('throws on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response))
    const watcher = createEsploraWatcher({ baseUrl: 'https://x/api', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(watcher.getAddressStatus(ADDR, { minAmountSats: 1, requiredConfirmations: 1 })).rejects.toThrow(/Esplora HTTP 503/)
  })
})

describe('watchAddress', () => {
  const request = { address: ADDR, amountSats: 50_000, uri: 'bitcoin:…', createdAt: 0, expiresAt: 1_000 }

  it('resolves paid once the watcher reports paid (injected sleep)', async () => {
    const statuses: BitcoinPaymentStatus[] = [
      { address: ADDR, status: 'pending', receivedSats: 0, confirmations: 0 },
      { address: ADDR, status: 'pending', receivedSats: 50_000, confirmations: 0, txid: 't' },
      { address: ADDR, status: 'paid', receivedSats: 50_000, confirmations: 1, txid: 't' }
    ]
    let i = 0
    const watcher: BitcoinWatcher = { getAddressStatus: async () => statuses[Math.min(i++, statuses.length - 1)] }
    const seen: string[] = []
    const final = await watchAddress({
      watcher, request, intervalMs: 1, timeoutMs: 10_000,
      now: () => 0, sleep: async () => {}, onUpdate: (s) => seen.push(s.status)
    })
    expect(final.status).toBe('paid')
    expect(seen).toEqual(['pending', 'pending', 'paid'])
  })

  it('returns expired once the request window passes with no confirmed payment', async () => {
    const watcher: BitcoinWatcher = { getAddressStatus: async () => ({ address: ADDR, status: 'pending', receivedSats: 0, confirmations: 0 }) }
    let t = 0
    const final = await watchAddress({
      watcher, request, intervalMs: 1, timeoutMs: 10_000,
      now: () => { t += 600_000; return t }, // jumps past expiresAt*1000 on the first tick
      sleep: async () => {}
    })
    expect(final.status).toBe('expired')
  })
})
