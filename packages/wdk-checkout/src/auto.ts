import { mountCheckout } from './widget.js'
import type { WdkPayConfig } from './types.js'

/**
 * Auto-mount entry. Bundled to `wdk-checkout.js` and loaded by the WooCommerce
 * plugin on the order-pay page. Reads the merchant config from `window.WDK_PAY`
 * and mounts the widget into `#wdk-pay-root`.
 */
function boot (): void {
  const config = (window as unknown as { WDK_PAY?: WdkPayConfig }).WDK_PAY
  const root = document.getElementById('wdk-pay-root')
  if (!config || !root) return
  try {
    mountCheckout(root, config)
  } catch (err) {
    root.textContent = err instanceof Error ? err.message : 'Failed to start checkout.'
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
