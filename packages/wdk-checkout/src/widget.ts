import type { PaymentIntent, PaymentStatus, WdkPayConfig } from './types.js'
import { payIntent } from './usdt.js'
import { qrDataUrl } from './qr.js'

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

  root.innerHTML = ''
  const el = buildDom(intent)
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
      finishConfirmed(el, config)
      setStatus('confirmed')
      stopTimers()
    } else if (ok === 'failed') {
      setStatus('failed', 'We could not verify that transaction. Check the hash, amount, and recipient and try again.')
    } else {
      // pending → keep polling the same hash until confirmed/failed
      if (!pollTimer) {
        pollTimer = setInterval(async () => {
          const s = await postConfirm(config, txHash, from)
          if (s === 'confirmed') { finishConfirmed(el, config); setStatus('confirmed'); stopTimers() } else if (s === 'failed') { setStatus('failed', 'Verification failed.'); stopTimers() }
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
    el.countdown.textContent = remaining > 0 ? `Payment window: ${formatRemaining(remaining)}` : 'Payment window expired — refresh to retry.'
  }
  tickCountdown()
  countdownTimer = setInterval(tickCountdown, 1000)

  function stopTimers () {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = undefined }
  }

  if (status === 'confirmed') { finishConfirmed(el, config); setStatus('confirmed') }

  return () => { stopTimers(); root.innerHTML = '' }
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

function buildDom (intent: PaymentIntent): Dom {
  const container = div({ maxWidth: '420px', margin: '0 auto', fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#161312' })

  const amountCard = div({ background: '#161312', color: '#f7eee8', borderRadius: '14px', padding: '20px', textAlign: 'center', marginBottom: '16px' })
  amountCard.innerHTML = `
    <div style="font-size:13px;opacity:.75">Amount due</div>
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
  Object.assign(hashInput.style, { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '13px', boxSizing: 'border-box', marginBottom: '8px' })
  manualPanel.appendChild(hashInput)
  const confirmBtn = button('Confirm payment')
  manualPanel.appendChild(confirmBtn)

  container.append(walletPanel, manualPanel)

  const statusBox = div({ marginTop: '14px', minHeight: '20px', fontSize: '13px' })
  container.appendChild(statusBox)

  const countdown = div({ marginTop: '10px', fontSize: '12px', color: '#6b6b6b', textAlign: 'center' })
  container.appendChild(countdown)

  const footer = div({ marginTop: '12px', fontSize: '11px', color: '#9a9a9a', textAlign: 'center' })
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
    idle: { color: '#6b6b6b', label: '' },
    connecting: { color: '#1f6feb', label: 'Connecting…' },
    'awaiting-signature': { color: '#1f6feb', label: 'Confirm in your wallet…' },
    submitted: { color: '#1f6feb', label: 'Submitted…' },
    confirming: { color: '#f4642f', label: 'Verifying…' },
    confirmed: { color: '#16a34a', label: 'Payment confirmed ✓' },
    failed: { color: '#dc2626', label: 'Payment failed' }
  }
  const s = map[status]
  el.statusBox.innerHTML = message || s.label ? `<span style="color:${s.color}">${esc(message || s.label)}</span>` : ''
  void config
}

function finishConfirmed (el: Dom, config: WdkPayConfig) {
  el.statusBox.innerHTML = '<span style="color:#16a34a;font-weight:600">Payment confirmed ✓ — redirecting…</span>'
  setTimeout(() => { window.location.href = config.returnUrl }, 1500)
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
  Object.assign(el.style, { fontSize: '12px', color: '#6b6b6b', lineHeight: '1.5', margin: '10px 0 0' })
  return el
}
function button (label: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.innerHTML = label
  Object.assign(b.style, { width: '100%', padding: '13px', borderRadius: '10px', border: 'none', background: '#f4642f', color: '#fff', fontSize: '15px', fontWeight: '600', cursor: 'pointer' })
  return b
}
function tabButton (label: string, active: boolean): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  Object.assign(b.style, { flex: '1', padding: '8px', borderRadius: '8px', border: '1px solid #e2e2e2', background: '#fff', fontSize: '13px', cursor: 'pointer', opacity: active ? '1' : '.55' })
  return b
}
function labeled (label: string, valueHtml: string): HTMLElement {
  const wrap = div({ margin: '10px 0' })
  wrap.innerHTML = `<div style="font-size:11px;color:#9a9a9a;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">${esc(label)}</div><div style="font-size:14px">${valueHtml}</div>`
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
