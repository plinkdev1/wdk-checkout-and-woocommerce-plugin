import type { CheckoutTheme, PaymentIntent, PaymentStatus, WdkPayConfig } from './types.js'
import { DEFAULT_CHECKOUT_THEME } from './types.js'
import { payIntent } from './usdt.js'
import { qrDataUrl } from './qr.js'
import { fiatDisplayLine } from './pricing.js'

const TX_RE = /^0x[0-9a-fA-F]{64}$/

/**
 * Renders the WDK checkout widget into `root` and wires the full payment flow:
 * pay with a connected wallet, or pay manually and confirm by transaction hash.
 * Returns a teardown function.
 */
export function mountCheckout (root: HTMLElement, config: WdkPayConfig): () => void {
  const { intent } = config
  let status: PaymentStatus = intent.status === 'confirmed' ? 'confirmed' : 'idle'
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let countdownTimer: ReturnType<typeof setInterval> | undefined
  let redirectTimer: ReturnType<typeof setTimeout> | undefined

  const theme: CheckoutTheme = { ...DEFAULT_CHECKOUT_THEME, ...config.theme }

  root.innerHTML = ''
  const el = buildDom(intent, theme)
  root.appendChild(el.container)

  function setStatus (next: PaymentStatus, message?: string) {
    status = next
    renderStatus(el, status, message, config)
    el.payBtn.disabled = next === 'connecting' || next === 'awaiting-signature' || next === 'submitted' || next === 'confirming' || next === 'confirmed'
    el.confirmBtn.disabled = el.payBtn.disabled
  }

  async function confirmHash (txHash: string, from?: string) {
    setStatus('confirming', 'Verifying your payment on-chain…')
    const ok = await postConfirm(config, txHash, from)
    if (ok === 'confirmed') {
      redirectTimer = finishConfirmed(el, config)
      setStatus('confirmed')
      stopTimers()
    } else if (ok === 'failed') {
      setStatus('failed', 'We could not verify that transaction. Check the hash, amount, and recipient and try again.')
    } else {
      // pending → keep polling the same hash until confirmed/failed
      if (!pollTimer) {
        pollTimer = setInterval(async () => {
          const s = await postConfirm(config, txHash, from)
          if (s === 'confirmed') { redirectTimer = finishConfirmed(el, config); setStatus('confirmed'); stopTimers() } else if (s === 'failed') { setStatus('failed', 'Verification failed.'); stopTimers() }
        }, 5000)
      }
    }
  }

  el.payBtn.addEventListener('click', async () => {
    try {
      setStatus('connecting', 'Connecting your wallet…')
      setStatus('awaiting-signature', 'Confirm the payment in your wallet…')
      const txHash = await payIntent(intent)
      setStatus('submitted', 'Payment submitted. Waiting for confirmation…')
      await confirmHash(txHash)
    } catch (err) {
      setStatus('failed', err instanceof Error ? err.message : 'Payment failed.')
    }
  })

  el.confirmBtn.addEventListener('click', async () => {
    const txHash = el.hashInput.value.trim()
    if (!TX_RE.test(txHash)) { setStatus('failed', 'Enter a valid transaction hash (0x…64 hex chars).'); return }
    await confirmHash(txHash)
  })

  el.tabs.wallet.addEventListener('click', () => switchTab(el, 'wallet'))
  el.tabs.manual.addEventListener('click', () => switchTab(el, 'manual'))

  // Countdown
  function tickCountdown () {
    const remaining = intent.expiresAt * 1000 - Date.now()
    if (remaining > 0) {
      el.countdown.textContent = `Payment window: ${formatRemaining(remaining)}`
      return
    }
    el.countdown.textContent = 'Payment window expired — refresh to retry.'
    // Stop ticking and block paying into a stale intent — but never yank the UI
    // out from under a payment that's already in flight or confirmed.
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = undefined }
    if (status === 'idle' || status === 'failed') {
      el.payBtn.disabled = true
      el.confirmBtn.disabled = true
    }
  }
  tickCountdown()
  countdownTimer = setInterval(tickCountdown, 1000)

  function stopTimers () {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = undefined }
  }

  if (status === 'confirmed') { redirectTimer = finishConfirmed(el, config); setStatus('confirmed') }

  return () => { stopTimers(); if (redirectTimer) clearTimeout(redirectTimer); root.innerHTML = '' }
}

interface Dom {
  container: HTMLElement
  payBtn: HTMLButtonElement
  confirmBtn: HTMLButtonElement
  hashInput: HTMLInputElement
  statusBox: HTMLElement
  countdown: HTMLElement
  panels: { wallet: HTMLElement, manual: HTMLElement }
  tabs: { wallet: HTMLButtonElement, manual: HTMLButtonElement }
}

function buildDom (intent: PaymentIntent, theme: CheckoutTheme): Dom {
  const container = div({ maxWidth: '420px', margin: '0 auto', fontFamily: 'var(--wp-font)', color: 'var(--wp-text)' })
  // Inject the palette as CSS variables; they cascade to every child element
  // (including the helper-built buttons/inputs), so a merchant can re-skin the
  // whole widget by passing `theme` to mountCheckout().
  const vars: Record<string, string> = {
    '--wp-surface': theme.surface, '--wp-on-surface': theme.onSurface, '--wp-text': theme.text,
    '--wp-text-muted': theme.textMuted, '--wp-text-faint': theme.textFaint, '--wp-accent': theme.accent,
    '--wp-accent-text': theme.accentText, '--wp-border': theme.border, '--wp-info': theme.info,
    '--wp-success': theme.success, '--wp-error': theme.error, '--wp-radius': theme.radius, '--wp-font': theme.fontFamily,
  }
  for (const [k, val] of Object.entries(vars)) container.style.setProperty(k, val)

  const amountCard = div({ background: 'var(--wp-surface)', color: 'var(--wp-on-surface)', borderRadius: 'var(--wp-radius)', padding: '20px', textAlign: 'center', marginBottom: '16px' })
  // Familiar fiat price (e.g. "$19.99"), shown above the on-chain amount when
  // the intent carries a store-currency total. The token amount is what settles.
  const fiat = fiatDisplayLine(intent)
  amountCard.innerHTML = `
    <div style="font-size:13px;opacity:.75">Amount due</div>
    ${fiat ? `<div style="font-size:15px;opacity:.85;margin-top:2px">${esc(fiat)}</div>` : ''}
    <div style="font-size:30px;font-weight:700;letter-spacing:-.5px">${esc(intent.amount)} ${esc(intent.tokenSymbol)}</div>
    <div style="font-size:12px;opacity:.7;margin-top:4px">on ${esc(intent.chainName)}</div>`
  container.appendChild(amountCard)

  const tabBar = div({ display: 'flex', gap: '6px', marginBottom: '14px' })
  const walletTab = tabButton('Pay with wallet', true)
  const manualTab = tabButton('Pay manually', false)
  tabBar.append(walletTab, manualTab)
  container.appendChild(tabBar)

  // Wallet panel
  const walletPanel = div({})
  const payBtn = button(`Pay ${esc(intent.amount)} ${esc(intent.tokenSymbol)}`)
  walletPanel.appendChild(payBtn)
  const hint = p('Pay directly from a WDK-powered or any EVM wallet. You stay in custody of your funds the entire time.')
  walletPanel.appendChild(hint)

  // Manual panel
  const manualPanel = div({ display: 'none' })
  const qr = document.createElement('img')
  qr.src = qrDataUrl(intent.receivingAddress)
  qr.alt = 'Receiving address QR'
  Object.assign(qr.style, { width: '180px', height: '180px', display: 'block', margin: '0 auto 12px', borderRadius: '10px' })
  manualPanel.appendChild(qr)
  manualPanel.appendChild(labeled('Send exactly', `${esc(intent.amount)} ${esc(intent.tokenSymbol)} (${esc(intent.chainName)})`))
  manualPanel.appendChild(labeled('To address', `<code style="word-break:break-all;font-size:12px">${esc(intent.receivingAddress)}</code>`))
  const hashLabel = p('Already paid from another wallet? Paste your transaction hash to confirm:')
  manualPanel.appendChild(hashLabel)
  const hashInput = document.createElement('input')
  hashInput.placeholder = '0x…'
  Object.assign(hashInput.style, { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--wp-border)', fontSize: '13px', boxSizing: 'border-box', marginBottom: '8px' })
  manualPanel.appendChild(hashInput)
  const confirmBtn = button('Confirm payment')
  manualPanel.appendChild(confirmBtn)

  container.append(walletPanel, manualPanel)

  const statusBox = div({ marginTop: '14px', minHeight: '20px', fontSize: '13px' })
  container.appendChild(statusBox)

  const countdown = div({ marginTop: '10px', fontSize: '12px', color: 'var(--wp-text-muted)', textAlign: 'center' })
  container.appendChild(countdown)

  const footer = div({ marginTop: '12px', fontSize: '11px', color: 'var(--wp-text-faint)', textAlign: 'center' })
  footer.textContent = 'Secured by WDK · self-custodial · on-chain verified'
  container.appendChild(footer)

  return {
    container,
    payBtn,
    confirmBtn,
    hashInput,
    statusBox,
    countdown,
    panels: { wallet: walletPanel, manual: manualPanel },
    tabs: { wallet: walletTab, manual: manualTab }
  }
}

function switchTab (el: Dom, tab: 'wallet' | 'manual') {
  const isWallet = tab === 'wallet'
  el.panels.wallet.style.display = isWallet ? 'block' : 'none'
  el.panels.manual.style.display = isWallet ? 'none' : 'block'
  el.tabs.wallet.style.opacity = isWallet ? '1' : '.55'
  el.tabs.manual.style.opacity = isWallet ? '.55' : '1'
}

function renderStatus (el: Dom, status: PaymentStatus, message: string | undefined, config: WdkPayConfig) {
  const map: Record<PaymentStatus, { color: string, label: string }> = {
    idle: { color: 'var(--wp-text-muted)', label: '' },
    connecting: { color: 'var(--wp-info)', label: 'Connecting…' },
    'awaiting-signature': { color: 'var(--wp-info)', label: 'Confirm in your wallet…' },
    submitted: { color: 'var(--wp-info)', label: 'Submitted…' },
    confirming: { color: 'var(--wp-accent)', label: 'Verifying…' },
    confirmed: { color: 'var(--wp-success)', label: 'Payment confirmed ✓' },
    failed: { color: 'var(--wp-error)', label: 'Payment failed' }
  }
  const s = map[status]
  el.statusBox.innerHTML = message || s.label ? `<span style="color:${s.color}">${esc(message || s.label)}</span>` : ''
  void config
}

function finishConfirmed (el: Dom, config: WdkPayConfig): ReturnType<typeof setTimeout> {
  el.statusBox.innerHTML = '<span style="color:var(--wp-success);font-weight:600">Payment confirmed ✓ — redirecting…</span>'
  return setTimeout(() => { window.location.href = config.returnUrl }, 1500)
}

async function postConfirm (config: WdkPayConfig, txHash: string, from?: string): Promise<'confirmed' | 'pending' | 'failed'> {
  try {
    const res = await fetch(config.endpoints.confirm, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': config.nonce },
      body: JSON.stringify({ orderKey: config.intent.orderKey, txHash, from, chainId: config.intent.chainId })
    })
    const data = (await res.json()) as { status?: string }
    if (data.status === 'confirmed') return 'confirmed'
    if (data.status === 'failed') return 'failed'
    return 'pending'
  } catch {
    return 'pending'
  }
}

// ---- tiny DOM helpers ----

function div (style: Partial<CSSStyleDeclaration>): HTMLElement {
  const d = document.createElement('div')
  Object.assign(d.style, style)
  return d
}
function p (text: string): HTMLElement {
  const el = document.createElement('p')
  el.textContent = text
  Object.assign(el.style, { fontSize: '12px', color: 'var(--wp-text-muted)', lineHeight: '1.5', margin: '10px 0 0' })
  return el
}
function button (label: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.innerHTML = label
  Object.assign(b.style, { width: '100%', padding: '13px', borderRadius: '10px', border: 'none', background: 'var(--wp-accent)', color: 'var(--wp-accent-text)', fontSize: '15px', fontWeight: '600', cursor: 'pointer' })
  return b
}
function tabButton (label: string, active: boolean): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  Object.assign(b.style, { flex: '1', padding: '8px', borderRadius: '8px', border: '1px solid var(--wp-border)', background: 'transparent', fontSize: '13px', cursor: 'pointer', color: 'inherit', opacity: active ? '1' : '.55' })
  return b
}
function labeled (label: string, valueHtml: string): HTMLElement {
  const wrap = div({ margin: '10px 0' })
  wrap.innerHTML = `<div style="font-size:11px;color:var(--wp-text-faint);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">${esc(label)}</div><div style="font-size:14px">${valueHtml}</div>`
  return wrap
}
/** HTML-escapes untrusted strings before they go into the widget's innerHTML (XSS guard). */
export function esc (s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export function formatRemaining (ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
