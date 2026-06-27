import { describe, it, expect, afterEach } from 'vitest'
import { tokenIconUrl, tokenChipDataUri, configureTokenIcons } from './token-icon.js'

const DEFAULT_BASE = 'https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@@web3icons%2Fcore@4.0.51/packages/core/src/svgs/tokens/branded'

afterEach(() => { configureTokenIcons({ baseUrl: DEFAULT_BASE }) })

describe('tokenIconUrl', () => {
  it('uppercases the symbol and points at the @web3icons branded set (non-builtin tokens)', () => {
    expect(tokenIconUrl('eth')).toBe(`${DEFAULT_BASE}/ETH.svg`)
    expect(tokenIconUrl('usdc')).toBe(`${DEFAULT_BASE}/USDC.svg`)
  })

  it('returns the embedded Tether brand mark for USDt / XAUt (always correct, offline)', () => {
    for (const sym of ['usdt', 'USDt', 'xaut', 'XAUt']) {
      const uri = tokenIconUrl(sym)
      expect(uri.startsWith('data:image/svg+xml')).toBe(true)
      // the canonical Tether glyph path is present
      expect(decodeURIComponent(uri)).toContain('M17.922 17.383')
    }
    // green disc for USD₮, gold disc for Tether Gold
    expect(decodeURIComponent(tokenIconUrl('USDT'))).toContain('#26A17B')
    expect(decodeURIComponent(tokenIconUrl('XAUT'))).toContain('#C7A647')
  })

  it('strips non-alphanumerics (so odd symbols still form a valid filename)', () => {
    expect(tokenIconUrl('a-b.c')).toBe(`${DEFAULT_BASE}/ABC.svg`)
  })

  it('honors a configured base URL for non-builtin tokens (pin a version / self-host)', () => {
    configureTokenIcons({ baseUrl: 'https://icons.example/branded/' }) // trailing slash trimmed
    expect(tokenIconUrl('dai')).toBe('https://icons.example/branded/DAI.svg')
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
