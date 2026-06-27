import { mountCheckout } from './widget.js'
import type { WdkPayConfig } from './types.js'

/**
 * Presentation modes (Phase 5 item 22) — launch the checkout as a centered
 * **modal/overlay** or a mobile **bottom-sheet**, in addition to the inline mount.
 * The overlay is a focus-trapped `role="dialog"` (completing the focus-trap +
 * restore deferred from the #18 accessibility pass): Tab cycles within the panel,
 * Escape / backdrop-click / the close button dismiss it, and focus returns to the
 * element that launched it.
 */
export interface CheckoutModalOptions {
  /** `modal` (centered card, default) or `sheet` (bottom-sheet, mobile-friendly). */
  readonly layout?: 'modal' | 'sheet'
  /** Panel background (the widget skins its own card; this is the dialog surround). */
  readonly background?: string
  /** Accessible label for the close button (default "Close"). */
  readonly closeLabel?: string
  /** Called after the modal is dismissed. */
  readonly onClose?: () => void
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Open the checkout in an overlay. Returns a `close()` function; the modal also
 * closes on Escape, backdrop click, or the close button.
 */
export function openCheckoutModal (config: WdkPayConfig, opts: CheckoutModalOptions = {}): () => void {
  const layout = opts.layout ?? 'modal'
  const sheet = layout === 'sheet'
  const previouslyFocused = document.activeElement as HTMLElement | null

  const overlay = document.createElement('div')
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.6)', zIndex: '2147483646',
    display: 'flex', justifyContent: 'center', alignItems: sheet ? 'flex-end' : 'center',
    padding: sheet ? '0' : '20px',
  })

  const panel = document.createElement('div')
  Object.assign(panel.style, {
    position: 'relative', background: opts.background ?? '#ffffff', boxSizing: 'border-box',
    width: '100%', maxWidth: sheet ? '100%' : '460px', maxHeight: '90vh', overflow: 'auto',
    borderRadius: sheet ? '18px 18px 0 0' : '16px', padding: '18px',
    boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
  })

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.setAttribute('aria-label', opts.closeLabel ?? 'Close')
  closeBtn.textContent = '✕'
  Object.assign(closeBtn.style, {
    position: 'absolute', top: '10px', right: '12px', background: 'none', border: 'none',
    fontSize: '18px', lineHeight: '1', cursor: 'pointer', color: 'inherit',
  })

  const mountPoint = document.createElement('div')
  panel.append(closeBtn, mountPoint)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  const teardownWidget = mountCheckout(mountPoint, config)

  let closed = false
  const destroy = (): void => {
    if (closed) return
    closed = true
    teardownWidget()
    document.removeEventListener('keydown', onKey, true)
    overlay.remove()
    previouslyFocused?.focus?.()
    opts.onClose?.()
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.stopPropagation(); destroy(); return }
    if (e.key !== 'Tab') return
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) { e.preventDefault(); return }
    const active = document.activeElement
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }

  closeBtn.addEventListener('click', destroy)
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) destroy() })
  document.addEventListener('keydown', onKey, true)

  // Initial focus inside the dialog (the pay button if present, else the close button).
  const firstFocusable = panel.querySelector<HTMLElement>('[data-wdk="pay-button"], button')
  ;(firstFocusable ?? closeBtn).focus()

  return destroy
}

/**
 * Wire a trigger element (e.g. a "Pay" button) to launch the modal on click.
 * Returns a function that detaches the listener.
 */
export function attachCheckoutModal (
  trigger: HTMLElement,
  config: WdkPayConfig,
  opts?: CheckoutModalOptions,
): () => void {
  const onClick = (): void => { openCheckoutModal(config, opts) }
  trigger.addEventListener('click', onClick)
  return () => trigger.removeEventListener('click', onClick)
}
