import { mountCheckout } from './widget.js'
import { resolveAutoConfig } from './auto.js'
import type { WdkPayConfig } from './types.js'

/**
 * `<wdk-pay>` custom element (Phase 5 item 20). Wraps {@link mountCheckout} in a
 * Shadow root so the widget's styles can't collide with the host page (and vice
 * versa), and it drops into React / Vue / Svelte / plain HTML identically.
 *
 *   <wdk-pay data-config='{"intent":{…},…}'></wdk-pay>
 *   // or set the property from JS:  document.querySelector('wdk-pay').config = {…}
 *
 * Config resolves in order: a `config` JS property → the same `data-*` rules as
 * the one-tag auto-mount (`data-config` JSON / `data-config-var` / window.WDK_PAY).
 * The mount is torn down on disconnect.
 */

// Resolve the base class lazily so this module is safe to *import* in a non-DOM
// environment (Node, SSR, unit tests). `HTMLElement` only exists in the browser;
// the empty fallback is never constructed there because {@link defineWdkPayElement}
// no-ops when Custom Elements are unavailable.
const ElementBase: typeof HTMLElement =
  typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown as typeof HTMLElement)

export class WdkPayElement extends ElementBase {
  /** Optional config set imperatively (takes precedence over data-* attributes). */
  config?: WdkPayConfig

  private teardown?: () => void

  connectedCallback (): void {
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    const config = this.resolveConfig()
    if (!config) {
      shadow.textContent = 'WDK Pay: no config (set the `config` property or a data-config attribute).'
      return
    }
    const root = document.createElement('div')
    shadow.appendChild(root)
    try {
      this.teardown = mountCheckout(root, config)
    } catch (err) {
      shadow.textContent = err instanceof Error ? err.message : 'Failed to start checkout.'
    }
  }

  disconnectedCallback (): void {
    this.teardown?.()
    this.teardown = undefined
  }

  private resolveConfig (): WdkPayConfig | null {
    if (this.config && typeof this.config === 'object') return this.config
    const globals = (typeof window !== 'undefined' ? window : {}) as unknown as Record<string, unknown>
    return resolveAutoConfig(this.dataset as Record<string, string | undefined>, globals)
  }
}

/**
 * Register the `<wdk-pay>` element (idempotent). Safe to call in any environment;
 * a no-op where Custom Elements aren't available.
 */
export function defineWdkPayElement (tag = 'wdk-pay'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, WdkPayElement)
  }
}
