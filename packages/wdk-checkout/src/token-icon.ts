/**
 * Token icons for the checkout widget — full `@web3icons` coverage.
 *
 * The widget renders the payment token's real logo from the @web3icons catalog
 * (the same ~4000-token library the WDK wallet uses), so a merchant can accept
 * ANY token without anyone hand-wiring an icon. Unknown symbols fall back to a
 * deterministic colored chip (first letter on a hashed hue) — an unconfigured
 * or exotic token never produces a broken image.
 *
 * Icons load at RUNTIME by symbol (an <img> pointing at the @web3icons CDN), so
 * the widget bundle stays tiny — none of the 4000 icons are bundled. The base
 * URL is overridable via {@link configureTokenIcons} so a dev can pin a version
 * or self-host a mirror.
 */

// @web3icons "branded" SVGs are keyed by UPPERCASE ticker. Pinned to an
// immutable release tag (not @main) so an upstream restructure can't move the
// path out from under production; override via configureTokenIcons() to take a
// newer version or self-host. (Even if a URL ever 404s, the chip fallback
// renders — nothing breaks.)
let brandedBaseUrl = 'https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@@web3icons%2Fcore@4.0.51/packages/core/src/svgs/tokens/branded'

/** Override the @web3icons icon base URL (e.g. to pin a version or self-host). */
export function configureTokenIcons (opts: { baseUrl: string }): void {
  brandedBaseUrl = opts.baseUrl.replace(/\/$/, '')
}

/** Normalize a symbol to the @web3icons filename form (uppercase, alphanumerics). */
function normalizeSymbol (symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// The canonical Tether "₮" glyph (white), shared by USD₮ and Tether Gold.
const TETHER_GLYPH =
  'M17.922 17.383v-.002c-.11.008-.677.042-1.942.042-1.01 0-1.721-.03-1.971-.042v.003c-3.888-.171-6.79-.848-6.79-1.658 0-.809 2.902-1.486 6.79-1.66v2.644c.254.018.982.061 1.988.061 1.207 0 1.812-.05 1.925-.06v-2.643c3.88.173 6.775.85 6.775 1.658 0 .81-2.895 1.485-6.775 1.657m0-3.59v-2.366h5.414V7.819H8.595v3.608h5.414v2.365c-4.4.202-7.709 1.074-7.709 2.118 0 1.044 3.309 1.915 7.709 2.118v7.582h3.913v-7.584c4.393-.202 7.694-1.073 7.694-2.116 0-1.043-3.301-1.914-7.694-2.117'

/** The Tether brand mark on a colored disc (USD₮ green, Tether Gold gold). */
function tetherMark (disc: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    `<circle cx="16" cy="16" r="16" fill="${disc}"/>` +
    `<path fill="#fff" d="${TETHER_GLYPH}"/></svg>`
  )
}

// The official Bitcoin mark (white ₿ on #F7931A), and the Ethereum diamond
// (white facets on #627EEA) — the real, recognizable coin logos, embedded so the
// headline assets always render correctly offline. Vector data from the
// MIT-licensed cryptocurrency-icons set.
const BITCOIN_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<circle cx="16" cy="16" r="16" fill="#F7931A"/>' +
  '<path fill="#fff" fill-rule="nonzero" d="M23.189 14.02c.314-2.096-1.283-3.223-3.465-3.975l.708-2.84-1.728-.43-.69 2.765c-.454-.114-.92-.22-1.385-.326l.695-2.783L15.596 6l-.708 2.839c-.376-.086-.746-.17-1.104-.26l.002-.009-2.384-.595-.46 1.846s1.283.294 1.256.312c.7.175.826.638.805 1.006l-.806 3.235c.048.012.11.03.18.057l-.183-.045-1.13 4.532c-.086.212-.303.531-.793.41.018.025-1.256-.313-1.256-.313l-.858 1.978 2.25.561c.418.105.828.215 1.231.318l-.715 2.872 1.727.43.708-2.84c.472.127.93.245 1.378.357l-.706 2.828 1.728.43.715-2.866c2.948.558 5.164.333 6.097-2.333.752-2.146-.037-3.385-1.588-4.192 1.13-.26 1.98-1.003 2.207-2.538zm-3.95 5.538c-.533 2.147-4.148.986-5.32.695l.95-3.805c1.172.293 4.929.872 4.37 3.11zm.535-5.569c-.487 1.953-3.495.96-4.47.717l.86-3.45c.975.243 4.118.696 3.61 2.733z"/></svg>'

const ETHEREUM_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<circle cx="16" cy="16" r="16" fill="#627EEA"/>' +
  '<g fill="#fff" fill-rule="nonzero">' +
  '<path fill-opacity=".602" d="M16.498 4v8.87l7.497 3.35z"/><path d="M16.498 4L9 16.22l7.498-3.35z"/>' +
  '<path fill-opacity=".602" d="M16.498 21.968v6.027L24 17.616z"/><path d="M16.498 27.995v-6.028L9 17.616z"/>' +
  '<path fill-opacity=".2" d="M16.498 20.573l7.497-4.353-7.497-3.348z"/><path fill-opacity=".602" d="M9 16.22l7.498 4.353v-7.701z"/></g></svg>'

/**
 * Built-in brand marks for the headline assets — embedded so they ALWAYS render
 * the correct, real logo with no dependency on the remote @web3icons CDN (which
 * can be slow, version-shifted, or blocked). The long tail of other tokens still
 * loads from the CDN; only these are guaranteed locally. WBTC/WETH reuse the
 * underlying asset's mark.
 */
const BUILTIN_MARKS: Record<string, string> = {
  USDT: tetherMark('#26A17B'),
  USDT0: tetherMark('#26A17B'),
  XAUT: tetherMark('#C7A647'),
  BTC: BITCOIN_MARK,
  WBTC: BITCOIN_MARK,
  ETH: ETHEREUM_MARK,
  WETH: ETHEREUM_MARK,
}

/** Returns a `data:` URI for a built-in brand mark, or null if not built in. */
function builtinIconUri (symbol: string): string | null {
  const svg = BUILTIN_MARKS[normalizeSymbol(symbol)]
  return svg ? 'data:image/svg+xml;utf8,' + encodeURIComponent(svg) : null
}

/**
 * The icon URL for a token symbol: a built-in Tether brand mark when available
 * (USDt / XAUt — always correct, offline), otherwise the @web3icons CDN logo.
 */
export function tokenIconUrl (symbol: string): string {
  return builtinIconUri(symbol) ?? `${brandedBaseUrl}/${normalizeSymbol(symbol)}.svg`
}

/**
 * A deterministic colored-chip fallback as a `data:` SVG URI — the first letter
 * of the symbol on a hue hashed from the symbol, so the same token always gets
 * the same chip. Mirrors the wallet's TokenIcon fallback.
 */
export function tokenChipDataUri (symbol: string, size = 24): string {
  let h = 0
  for (let i = 0; i < symbol.length; i++) h = (h + symbol.charCodeAt(i) * 31) % 360
  const letter = (symbol.slice(0, 1) || '?').toUpperCase()
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="hsl(${h},55%,42%)"/>` +
    `<text x="50%" y="50%" font-family="system-ui,sans-serif" font-size="${Math.floor(size * 0.5)}" font-weight="600" ` +
    `fill="#fff" text-anchor="middle" dominant-baseline="central">${letter}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

/**
 * Build an <img> for a token logo: loads the real @web3icons branded SVG by
 * symbol, and swaps to the deterministic chip fallback if the symbol isn't in
 * the catalog (or the network is unavailable). Requires a DOM (browser widget).
 */
export function createTokenIcon (symbol: string, size = 24): HTMLImageElement {
  const img = document.createElement('img')
  img.width = size
  img.height = size
  img.alt = symbol
  Object.assign(img.style, { width: `${size}px`, height: `${size}px`, borderRadius: '50%', display: 'block', flex: '0 0 auto' })
  img.src = tokenIconUrl(symbol)
  img.onerror = () => { img.onerror = null; img.src = tokenChipDataUri(symbol, size) }
  return img
}
