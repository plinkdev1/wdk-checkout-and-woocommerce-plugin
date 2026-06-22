import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { discoverWallets, resolveWalletProvider, WDK_WALLET_RDNS, toHexChainId } from './eth.js'

/**
 * Minimal fake `window` with EIP-6963 event plumbing. `dispatchEvent` of
 * `eip6963:requestProvider` synchronously fires the registered announce
 * listener once per `announce()` we queue — mimicking wallets responding.
 */
function installFakeWindow (announce: Array<{ info: { uuid: string, name: string, icon: string, rdns: string }, provider: unknown }>): void {
  const listeners: Record<string, Array<(e: Event) => void>> = {}
  const fake = {
    addEventListener (type: string, cb: (e: Event) => void) { (listeners[type] ??= []).push(cb) },
    removeEventListener (type: string, cb: (e: Event) => void) { listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb) },
    dispatchEvent (e: Event) {
      if (e.type === 'eip6963:requestProvider') {
        for (const detail of announce) {
          const ev = { type: 'eip6963:announceProvider', detail } as unknown as Event
          for (const cb of listeners['eip6963:announceProvider'] ?? []) cb(ev)
        }
      }
      return true
    },
  }
  ;(globalThis as { window?: unknown }).window = fake
  // discoverWallets constructs `new Event(...)` — provide a tiny shim if absent.
  if (typeof (globalThis as { Event?: unknown }).Event === 'undefined') {
    ;(globalThis as { Event?: unknown }).Event = class { type: string; constructor (t: string) { this.type = t } }
  }
}

describe('eth — EIP-6963 wallet discovery', () => {
  afterEach(() => { delete (globalThis as { window?: unknown }).window })

  it('returns [] when there is no window (e.g. SSR/node)', async () => {
    delete (globalThis as { window?: unknown }).window
    expect(await discoverWallets(5)).toEqual([])
  })

  it('discovers announced wallets, de-duped by uuid', async () => {
    installFakeWindow([
      { info: { uuid: 'a', name: 'WDK Wallet', icon: '', rdns: WDK_WALLET_RDNS }, provider: { request: async () => {} } },
      { info: { uuid: 'a', name: 'WDK Wallet', icon: '', rdns: WDK_WALLET_RDNS }, provider: { request: async () => {} } }, // dup uuid
      { info: { uuid: 'b', name: 'Other', icon: '', rdns: 'com.other' }, provider: { request: async () => {} } },
    ])
    const found = await discoverWallets(5)
    expect(found.map((w) => w.info.uuid).sort()).toEqual(['a', 'b'])
  })

  it('resolveWalletProvider prefers the WDK wallet over others', async () => {
    const wdkProvider = { request: async () => 'wdk' }
    installFakeWindow([
      { info: { uuid: 'b', name: 'Other', icon: '', rdns: 'com.other' }, provider: { request: async () => 'other' } },
      { info: { uuid: 'a', name: 'WDK Wallet', icon: '', rdns: WDK_WALLET_RDNS }, provider: wdkProvider },
    ])
    const p = await resolveWalletProvider({ timeoutMs: 5 })
    expect(p).toBe(wdkProvider)
  })

  it('falls back to the first announced wallet when WDK is absent', async () => {
    const other = { request: async () => 'other' }
    installFakeWindow([{ info: { uuid: 'b', name: 'Other', icon: '', rdns: 'com.other' }, provider: other }])
    expect(await resolveWalletProvider({ timeoutMs: 5 })).toBe(other)
  })

  it('falls back to legacy window.ethereum when no wallet announces', async () => {
    installFakeWindow([])
    const legacy = { request: async () => 'legacy' }
    ;(globalThis as { ethereum?: unknown }).ethereum = legacy
    try {
      expect(await resolveWalletProvider({ timeoutMs: 5 })).toBe(legacy)
    } finally {
      delete (globalThis as { ethereum?: unknown }).ethereum
    }
  })
})

describe('toHexChainId', () => {
  it('formats numeric chain ids as 0x-hex', () => {
    expect(toHexChainId(1)).toBe('0x1')
    expect(toHexChainId(137)).toBe('0x89')
    expect(toHexChainId(42161)).toBe('0xa4b1')
  })
})
