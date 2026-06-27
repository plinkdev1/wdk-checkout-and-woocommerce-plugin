import { mountCheckout } from './widget.js'
import { defineWdkPayElement } from './web-component.js'
import type { WdkPayConfig } from './types.js'

/**
 * Auto-mount entry (Phase 5 item 19 — one-tag drop-in). Bundled to
 * `wdk-checkout.js`. Mounts the checkout into **any** element flagged
 * `data-wdk-pay`, reading its config with no JS wiring:
 *
 *   <!-- inline JSON -->
 *   <div data-wdk-pay data-config='{"intent":{…},"endpoints":{…},…}'></div>
 *
 *   <!-- a named page global -->
 *   <script>window.MY_CHECKOUT = {…}</script>
 *   <div data-wdk-pay data-config-var="MY_CHECKOUT"></div>
 *
 *   <!-- the WooCommerce path (default global) -->
 *   <div id="wdk-pay-root" data-wdk-pay="1"></div>   // uses window.WDK_PAY
 *
 * Mounting is idempotent per element (a `data-wdk-mounted` flag), so a second
 * scan never double-mounts.
 */

type Globals = Record<string, unknown>

/**
 * Resolve the {@link WdkPayConfig} for one mount point from its `data-*`
 * attributes and the page globals, in precedence order: inline `data-config`
 * JSON → `data-config-var` named global → the default `window.WDK_PAY`. Returns
 * `null` when nothing valid is found (or the JSON is malformed).
 */
export function resolveAutoConfig (
  dataset: Record<string, string | undefined>,
  globals: Globals,
): WdkPayConfig | null {
  if (typeof dataset.config === 'string' && dataset.config.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(dataset.config)
      return parsed && typeof parsed === 'object' ? (parsed as WdkPayConfig) : null
    } catch {
      return null
    }
  }
  if (typeof dataset.configVar === 'string' && dataset.configVar !== '') {
    const v = globals[dataset.configVar]
    return v && typeof v === 'object' ? (v as WdkPayConfig) : null
  }
  const fallback = globals.WDK_PAY
  return fallback && typeof fallback === 'object' ? (fallback as WdkPayConfig) : null
}

function mountOne (el: HTMLElement, globals: Globals): void {
  if (el.getAttribute('data-wdk-mounted') === '1') return
  const config = resolveAutoConfig(el.dataset as Record<string, string | undefined>, globals)
  if (!config) return
  el.setAttribute('data-wdk-mounted', '1')
  try {
    mountCheckout(el, config)
  } catch (err) {
    el.textContent = err instanceof Error ? err.message : 'Failed to start checkout.'
  }
}

/**
 * Scan a document for mount points and mount each. Idempotent per element.
 * Exported so a host can re-run it after injecting markup dynamically.
 */
export function autoMount (doc: Document, globals: Globals): void {
  doc.querySelectorAll<HTMLElement>('[data-wdk-pay]').forEach((el) => mountOne(el, globals))
  // Back-compat: an older `#wdk-pay-root` without the data flag still mounts from window.WDK_PAY.
  const legacy = doc.getElementById('wdk-pay-root')
  if (legacy && !legacy.hasAttribute('data-wdk-pay')) mountOne(legacy, globals)
}

function boot (): void {
  defineWdkPayElement() // register <wdk-pay> for the drop-in/Web-Component path
  autoMount(document, window as unknown as Globals)
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
}
