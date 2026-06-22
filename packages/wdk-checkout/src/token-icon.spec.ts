import { describe, it, expect, afterEach } from 'vitest'
import { tokenIconUrl, tokenChipDataUri, configureTokenIcons } from './token-icon.js'

const DEFAULT_BASE = 'https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@main/packages/core/src/svgs/tokens/branded'

afterEach(() => { configureTokenIcons({ baseUrl: DEFAULT_BASE }) })

describe('tokenIconUrl', () => {
  it('uppercases the symbol and points at the @web3icons branded set', () => {
    expect(tokenIconUrl('usdt')).toBe(`${DEFAULT_BASE}/USDT.svg`)
    expect(tokenIconUrl('USDt')).toBe(`${DEFAULT_BASE}/USDT.svg`)
    expect(tokenIconUrl('eth')).toBe(`${DEFAULT_BASE}/ETH.svg`)
  })

  it('strips non-alphanumerics (so odd symbols still form a valid filename)', () => {
    expect(tokenIconUrl('a-b.c')).toBe(`${DEFAULT_BASE}/ABC.svg`)
  })

  it('honors a configured base URL (pin a version / self-host)', () => {
    configureTokenIcons({ baseUrl: 'https://icons.example/branded/' }) // trailing slash trimmed
    expect(tokenIconUrl('usdc')).toBe('https://icons.example/branded/USDC.svg')
  })
})

describe('tokenChipDataUri (fallback)', () => {
  it('is a data: SVG URI containing the first letter', () => {
    const uri = tokenChipDataUri('USDT')
    expect(uri.startsWith('data:image/svg+xml')).toBe(true)
    expect(decodeURIComponent(uri)).toContain('>U<')
  })

  it('is deterministic — same symbol yields the same chip', () => {
    expect(tokenChipDataUri('XYZ')).toBe(tokenChipDataUri('XYZ'))
  })

  it('differs by symbol (different hue) and handles empty input', () => {
    expect(tokenChipDataUri('AAA')).not.toBe(tokenChipDataUri('ZZZ'))
    expect(decodeURIComponent(tokenChipDataUri(''))).toContain('>?<')
  })
})
