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

// @web3icons "branded" SVGs are keyed by UPPERCASE ticker.
let brandedBaseUrl = 'https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@main/packages/core/src/svgs/tokens/branded'

/** Override the @web3icons icon base URL (e.g. to pin a version or self-host). */
export function configureTokenIcons (opts: { baseUrl: string }): void {
  brandedBaseUrl = opts.baseUrl.replace(/\/$/, '')
}

/** Normalize a symbol to the @web3icons filename form (uppercase, alphanumerics). */
function normalizeSymbol (symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** The @web3icons CDN URL for a token symbol's branded logo. */
export function tokenIconUrl (symbol: string): string {
  return `${brandedBaseUrl}/${normalizeSymbol(symbol)}.svg`
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
