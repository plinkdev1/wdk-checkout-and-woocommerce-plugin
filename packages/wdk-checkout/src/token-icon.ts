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

/**
 * Built-in brand marks for the headline Tether assets — embedded so they ALWAYS
 * render the correct logo, with no dependency on the remote @web3icons CDN (which
 * can be slow, version-shifted, or blocked). The long tail of other tokens still
 * loads from the CDN; only these are guaranteed locally.
 */
const BUILTIN_MARKS: Record<string, string> = {
  USDT: tetherMark('#26A17B'),
  XAUT: tetherMark('#C7A647'),
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
