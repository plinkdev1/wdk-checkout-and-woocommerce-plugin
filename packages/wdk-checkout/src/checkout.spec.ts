/**
 * Unit tests for the checkout widget's pure surface: chain-id encoding,
 * the XSS-escaping guard, the countdown formatter, ethers/provider lookup, and
 * QR data-URL generation. These lock the building blocks the payment flow and
 * the rendered widget depend on (the on-chain transfer itself is exercised
 * against a wallet in integration/demo runs).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toHexChainId, getEthers, getInjectedProvider } from './eth.js';
import { esc, formatRemaining } from './widget.js';
import { qrDataUrl } from './qr.js';

describe('toHexChainId', () => {
  it('encodes chain ids to 0x-prefixed hex (EIP-1193)', () => {
    expect(toHexChainId(1)).toBe('0x1');         // Ethereum
    expect(toHexChainId(137)).toBe('0x89');      // Polygon
    expect(toHexChainId(42161)).toBe('0xa4b1');  // Arbitrum
    expect(toHexChainId(9745)).toBe('0x2611');   // Plasma
  });
});

describe('esc (XSS guard)', () => {
  it('escapes every HTML-significant character', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;');
    expect(esc(`"&'`)).toBe('&quot;&amp;&#39;');
  });

  it('neutralises an injection payload in a token symbol / order field', () => {
    const payload = '"><img src=x onerror=alert(1)>';
    const out = esc(payload);
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('"');
    expect(out).toContain('&lt;img');
  });

  it('leaves safe text untouched', () => {
    expect(esc('USDt 12.50')).toBe('USDt 12.50');
  });
});

describe('formatRemaining', () => {
  it('formats a countdown as m:ss', () => {
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(9_000)).toBe('0:09');
    expect(formatRemaining(65_000)).toBe('1:05');
    expect(formatRemaining(600_000)).toBe('10:00');
  });
});

describe('getEthers / getInjectedProvider', () => {
  const g = globalThis as unknown as { ethers?: unknown; ethereum?: unknown };
  beforeEach(() => { delete g.ethers; delete g.ethereum; });
  afterEach(() => { delete g.ethers; delete g.ethereum; });

  it('throws a clear error when the ethers UMD global is missing', () => {
    expect(() => getEthers()).toThrow(/ethers UMD library must be loaded/i);
  });

  it('returns the ethers global when present', () => {
    const fake = { version: 'x' };
    g.ethers = fake;
    expect(getEthers()).toBe(fake);
  });

  it('returns null when no injected provider, the provider when present', () => {
    expect(getInjectedProvider()).toBeNull();
    const provider = { request: async () => '0x1' };
    g.ethereum = provider;
    expect(getInjectedProvider()).toBe(provider);
  });
});

describe('qrDataUrl', () => {
  it('produces an image data URL for a payment string', () => {
    const url = qrDataUrl('ethereum:0xabc?value=1');
    expect(url.startsWith('data:image')).toBe(true);
  });

  it('is deterministic for the same input', () => {
    expect(qrDataUrl('same-input')).toBe(qrDataUrl('same-input'));
  });
});
