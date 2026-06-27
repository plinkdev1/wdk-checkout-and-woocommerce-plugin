import type { CheckoutBrand, CheckoutStrings, CheckoutTheme, PaymentIntent, PaymentStatus, WdkPayConfig } from './types.js'
import { resolveCheckoutTheme, resolveCheckoutStrings } from './types.js'
import { payIntent } from './usdt.js'
import { qrDataUrl } from './qr.js'
import { fiatDisplayLine } from './pricing.js'
import { createTokenIcon } from './token-icon.js'

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

  const prefersDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
  const theme: CheckoutTheme = resolveCheckoutTheme({ preset: config.preset, mode: config.mode, theme: config.theme }, prefersDark)
  const strings = resolveCheckoutStrings(config.strings)

  root.innerHTML = ''
  const el = buildDom(intent, theme, strings, config.brand)
  // Merchant escape hatch: raw CSS scoped under the widget root (torn down with it).
  if (config.customCss) {
    const style = document.createElement('style')
    style.textContent = config.customCss
    el.container.appendChild(style)
  }
  root.appendChild(el.container)

  function setStatus (next: PaymentStatus, message?: string) {
    status = next
    renderStatus(el, status, message, strings)
    el.payBtn.disabled = next === 'connecting' || next === 'awaiting-signature' || next === 'submitted' || next === 'confirming' || next === 'confirmed'
    el.confirmBtn.disabled = el.payBtn.disabled
  }

  async function confirmHash (txHash: string, from?: string) {
    setStatus('confirming', strings.verifyingOnChain)
    const ok = await postConfirm(config, txHash, from)
    if (ok === 'confirmed') {
      redirectTimer = finishConfirmed(el, config, strings)
      setStatus('confirmed')
      stopTimers()
    } else if (ok === 'failed') {
      setStatus('failed', strings.couldNotVerify)
    } else {
      // pending → keep polling the same hash until confirmed/failed
      if (!pollTimer) {
        pollTimer = setInterval(async () => {
          const s = await postConfirm(config, txHash, from)
          if (s === 'confirmed') { redirectTimer = finishConfirmed(el, config, strings); setStatus('confirmed'); stopTimers() } else if (s === 'failed') { setStatus('failed', strings.verificationFailed); stopTimers() }
        }, 5000)
      }
    }
  }

  el.payBtn.addEventListener('click', async () => {
    try {
      setStatus('connecting', strings.connectingWallet)
      setStatus('awaiting-signature', strings.confirmInWalletLong)
      const txHash = await payIntent(intent)
      setStatus('submitted', strings.submittedWaiting)
      await confirmHash(txHash)
    } catch (err) {
      setStatus('failed', err instanceof Error ? err.message : strings.paymentFailed)
    }
  })

  el.confirmBtn.addEventListener('click', async () => {
    const txHash = el.hashInput.value.trim()
    if (!TX_RE.test(txHash)) { setStatus('failed', strings.invalidHash); return }
    await confirmHash(txHash)
  })

  el.tabs.wallet.addEventListener('click', () => switchTab(el, 'wallet'))
  el.tabs.manual.addEventListener('click', () => switchTab(el, 'manual'))

  // Countdown
  function tickCountdown () {
    const remaining = intent.expiresAt * 1000 - Date.now()
    if (remaining > 0) {
      el.countdown.textContent = `${strings.paymentWindow} ${formatRemaining(remaining)}`
      return
    }
    el.countdown.textContent = strings.paymentWindowExpired
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

  if (status === 'confirmed') { redirectTimer = finishConfirmed(el, config, strings); setStatus('confirmed') }

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

function buildDom (intent: PaymentIntent, theme: CheckoutTheme, strings: CheckoutStrings, brand?: CheckoutBrand): Dom {
  const container = div({ maxWidth: '420px', margin: '0 auto', fontFamily: 'var(--wp-font)', color: 'var(--wp-text)' })
  // Inject the palette as CSS variables; they cascade to every child element
  // (including the helper-built buttons/inputs), so a merchant can re-skin the
  // whole widget by passing `theme` to mountCheckout().
  // Per-element radii fall back to the global radius; the button style maps to a
  // background/foreground/border triple the helper-built buttons consume by var.
  const cardRadius = theme.cardRadius ?? theme.radius
  const buttonRadius = theme.buttonRadius ?? theme.radius
  const inputRadius = theme.inputRadius ?? theme.radius
  const buttonStyle = theme.buttonStyle ?? 'solid'
  const buttonSkin = buttonStyle === 'outline'
    ? { bg: 'transparent', fg: 'var(--wp-accent)', border: '1px solid var(--wp-accent)' }
    : buttonStyle === 'soft'
      ? { bg: 'color-mix(in srgb, var(--wp-accent) 16%, transparent)', fg: 'var(--wp-accent)', border: 'none' }
      : { bg: 'var(--wp-accent)', fg: 'var(--wp-accent-text)', border: 'none' }

  const vars: Record<string, string> = {
    '--wp-surface': theme.surface, '--wp-on-surface': theme.onSurface, '--wp-text': theme.text,
    '--wp-text-muted': theme.textMuted, '--wp-text-faint': theme.textFaint, '--wp-accent': theme.accent,
    '--wp-accent-text': theme.accentText, '--wp-border': theme.border, '--wp-info': theme.info,
    '--wp-success': theme.success, '--wp-error': theme.error, '--wp-radius': theme.radius, '--wp-font': theme.fontFamily,
    '--wp-heading-font': theme.headingFontFamily ?? theme.fontFamily,
    '--wp-card-radius': cardRadius, '--wp-button-radius': buttonRadius, '--wp-input-radius': inputRadius,
    '--wp-button-bg': buttonSkin.bg, '--wp-button-fg': buttonSkin.fg, '--wp-button-border': buttonSkin.border,
  }
  for (const [k, val] of Object.entries(vars)) container.style.setProperty(k, val)

  // White-label brand header (logo + store name) — shown only when config.brand is set.
  if (brand && (brand.logoUrl || brand.name)) {
    const header = div({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '14px' })
    header.setAttribute('data-wdk', 'brand')
    if (brand.logoUrl) {
      const logo = document.createElement('img')
      logo.src = brand.logoUrl
      logo.alt = brand.logoAlt ?? brand.name ?? 'logo'
      Object.assign(logo.style, { height: '28px', width: 'auto', display: 'block' })
      header.appendChild(logo)
    }
    if (brand.name) {
      const name = document.createElement('span')
      name.textContent = brand.name
      Object.assign(name.style, { fontFamily: 'var(--wp-heading-font)', fontSize: '17px', fontWeight: '700', color: 'var(--wp-text)' })
      header.appendChild(name)
    }
    container.appendChild(header)
  }

  const amountCard = div({ background: 'var(--wp-surface)', color: 'var(--wp-on-surface)', borderRadius: 'var(--wp-card-radius)', padding: '20px', textAlign: 'center', marginBottom: '16px' })
  amountCard.setAttribute('data-wdk', 'amount-card')
  // Familiar fiat price (e.g. "$19.99"), shown above the on-chain amount when
  // the intent carries a store-currency total. The token amount is what settles.
  const fiat = fiatDisplayLine(intent)
  amountCard.innerHTML = `
    <div style="font-size:13px;opacity:.75">Amount due</div>
    ${fiat ? `<div style="font-size:15px;opacity:.85;margin-top:2px">${esc(fiat)}</div>` : ''}`
  // Amount line with the payment token's REAL @web3icons logo (chip fallback for
  // unknown tokens). textContent keeps it XSS-safe without manual escaping.
  const amountRow = div({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '30px', fontWeight: '700', letterSpacing: '-.5px', marginTop: '2px', fontFamily: 'var(--wp-heading-font)' })
  amountRow.appendChild(createTokenIcon(intent.tokenSymbol, 28))
  const amountText = document.createElement('span')
  amountText.textContent = `${intent.amount} ${intent.tokenSymbol}`
  amountRow.appendChild(amountText)
  amountCard.appendChild(amountRow)
  const chainLine = div({ fontSize: '12px', opacity: '.7', marginTop: '4px' })
  chainLine.textContent = `on ${intent.chainName}`
  amountCard.appendChild(chainLine)
  container.appendChild(amountCard)

  const tabBar = div({ display: 'flex', gap: '6px', marginBottom: '14px' })
  tabBar.setAttribute('role', 'tablist')
  tabBar.setAttribute('aria-label', strings.payWithWallet)
  const walletTab = tabButton(strings.payWithWallet, true)
  walletTab.id = 'wdk-tab-wallet'
  walletTab.setAttribute('aria-controls', 'wdk-panel-wallet')
  const manualTab = tabButton(strings.payManually, false)
  manualTab.id = 'wdk-tab-manual'
  manualTab.setAttribute('aria-controls', 'wdk-panel-manual')
  tabBar.append(walletTab, manualTab)
  container.appendChild(tabBar)

  // Wallet panel
  const walletPanel = div({})
  walletPanel.id = 'wdk-panel-wallet'
  walletPanel.setAttribute('role', 'tabpanel')
  walletPanel.setAttribute('aria-labelledby', 'wdk-tab-wallet')
  const payBtn = button(`${esc(strings.pay)} ${esc(intent.amount)} ${esc(intent.tokenSymbol)}`)
  walletPanel.appendChild(payBtn)
  const hint = p(strings.walletHint)
  walletPanel.appendChild(hint)

  // Manual panel
  const manualPanel = div({ display: 'none' })
  manualPanel.id = 'wdk-panel-manual'
  manualPanel.setAttribute('role', 'tabpanel')
  manualPanel.setAttribute('aria-labelledby', 'wdk-tab-manual')
  manualPanel.setAttribute('aria-hidden', 'true')
  const qr = document.createElement('img')
  qr.src = qrDataUrl(intent.receivingAddress)
  qr.alt = 'Receiving address QR'
  Object.assign(qr.style, { width: '180px', height: '180px', display: 'block', margin: '0 auto 12px', borderRadius: '10px' })
  manualPanel.appendChild(qr)
  manualPanel.appendChild(labeled(strings.sendExactly, `${esc(intent.amount)} ${esc(intent.tokenSymbol)} (${esc(intent.chainName)})`))
  manualPanel.appendChild(labeled(strings.toAddress, `<code style="word-break:break-all;font-size:12px">${esc(intent.receivingAddress)}</code>`))
  const hashLabel = p(strings.alreadyPaid)
  manualPanel.appendChild(hashLabel)
  const hashInput = document.createElement('input')
  hashInput.placeholder = '0x…'
  hashInput.setAttribute('aria-label', strings.hashInputAria)
  Object.assign(hashInput.style, { width: '100%', padding: '10px 12px', borderRadius: 'var(--wp-input-radius)', border: '1px solid var(--wp-border)', fontSize: '13px', boxSizing: 'border-box', marginBottom: '8px' })
  manualPanel.appendChild(hashInput)
  const confirmBtn = button(strings.confirmPayment)
  manualPanel.appendChild(confirmBtn)

  container.append(walletPanel, manualPanel)

  const statusBox = div({ marginTop: '14px', minHeight: '20px', fontSize: '13px' })
  statusBox.setAttribute('role', 'status')
  statusBox.setAttribute('aria-live', 'polite')
  container.appendChild(statusBox)

  const countdown = div({ marginTop: '10px', fontSize: '12px', color: 'var(--wp-text-muted)', textAlign: 'center' })
  container.appendChild(countdown)

  const footer = div({ marginTop: '12px', fontSize: '11px', color: 'var(--wp-text-faint)', textAlign: 'center' })
  footer.textContent = strings.securedBy
  footer.setAttribute('data-wdk', 'footer')
  container.appendChild(footer)

  // Stable hooks for merchant custom CSS (config.customCss) + external styling.
  container.setAttribute('data-wdk', 'root')
  payBtn.setAttribute('data-wdk', 'pay-button')
  confirmBtn.setAttribute('data-wdk', 'confirm-button')
  hashInput.setAttribute('data-wdk', 'hash-input')
  statusBox.setAttribute('data-wdk', 'status')
  countdown.setAttribute('data-wdk', 'countdown')
  walletPanel.setAttribute('data-wdk', 'panel-wallet')
  manualPanel.setAttribute('data-wdk', 'panel-manual')
  walletTab.setAttribute('data-wdk', 'tab-wallet')
  manualTab.setAttribute('data-wdk', 'tab-manual')

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
  el.panels.wallet.setAttribute('aria-hidden', String(!isWallet))
  el.panels.manual.setAttribute('aria-hidden', String(isWallet))
  el.tabs.wallet.style.opacity = isWallet ? '1' : '.55'
  el.tabs.manual.style.opacity = isWallet ? '.55' : '1'
  el.tabs.wallet.setAttribute('aria-selected', String(isWallet))
  el.tabs.manual.setAttribute('aria-selected', String(!isWallet))
}

function renderStatus (el: Dom, status: PaymentStatus, message: string | undefined, strings: CheckoutStrings) {
  const map: Record<PaymentStatus, { color: string, label: string }> = {
    idle: { color: 'var(--wp-text-muted)', label: '' },
    connecting: { color: 'var(--wp-info)', label: strings.statusConnecting },
    'awaiting-signature': { color: 'var(--wp-info)', label: strings.statusAwaitingSignature },
    submitted: { color: 'var(--wp-info)', label: strings.statusSubmitted },
    confirming: { color: 'var(--wp-accent)', label: strings.statusConfirming },
    confirmed: { color: 'var(--wp-success)', label: strings.statusConfirmed },
    failed: { color: 'var(--wp-error)', label: strings.statusFailed }
  }
  const s = map[status]
  el.statusBox.innerHTML = message || s.label ? `<span style="color:${s.color}">${esc(message || s.label)}</span>` : ''
}

function finishConfirmed (el: Dom, config: WdkPayConfig, strings: CheckoutStrings): ReturnType<typeof setTimeout> {
  el.statusBox.innerHTML = `<span style="color:var(--wp-success);font-weight:600">${esc(strings.confirmedRedirecting)}</span>`
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
  b.type = 'button'
  b.innerHTML = label
  Object.assign(b.style, { width: '100%', padding: '13px', borderRadius: 'var(--wp-button-radius)', border: 'var(--wp-button-border)', background: 'var(--wp-button-bg)', color: 'var(--wp-button-fg)', fontSize: '15px', fontWeight: '600', cursor: 'pointer' })
  return b
}
function tabButton (label: string, active: boolean): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.setAttribute('role', 'tab')
  b.setAttribute('aria-selected', String(active))
  b.textContent = label
  Object.assign(b.style, { flex: '1', padding: '8px', borderRadius: 'var(--wp-input-radius)', border: '1px solid var(--wp-border)', background: 'transparent', fontSize: '13px', cursor: 'pointer', color: 'inherit', opacity: active ? '1' : '.55' })
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
