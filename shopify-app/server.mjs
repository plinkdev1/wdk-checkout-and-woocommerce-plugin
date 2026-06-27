/**
 * WDK Pay — Shopify app (platform-breadth reference).
 *
 * The SAME framework-free `@wdk-starter/wdk-checkout` core that backs the
 * WooCommerce gateway, wired into Shopify's Payments Apps flow so a merchant can
 * accept self-custodial USDt on Shopify:
 *
 *   POST /payment_sessions          ← Shopify starts a payment (HMAC-signed).
 *                                     We mint an intent and return a redirect to
 *                                     our hosted checkout page.
 *   GET  /checkout?session=ID         The buyer pays here — the WDK Pay widget
 *                                     (mountCheckout) over their own EVM wallet.
 *   GET  /intent?session=ID           JSON intent the widget consumes.
 *   POST /confirm                     { session, txHash, chainId } → verify the
 *                                     transfer on-chain (wdk-payment-verifier) and
 *                                     paymentSessionResolve / Reject on Shopify.
 *   GET  /wdk-checkout.js             The built widget bundle.
 *
 * Funds settle straight to the merchant's address; Shopify only learns the
 * outcome. Session state is in-memory here for clarity — use a DB in production.
 *
 * Run:  SHOPIFY_SHOP=… SHOPIFY_ACCESS_TOKEN=… WDK_RPC_URL=… WDK_RECEIVING=0x… \
 *       node server.mjs
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { PaymentVerifier } from '@wdk-starter/wdk-payment-verifier'
import { config } from './src/config.mjs'
import { verifyShopifyHmac, resolvePaymentSession, rejectPaymentSession } from './src/shopify.mjs'

/** On-chain verifier (the published headless counterpart to the PHP verifier). */
const verifier = new PaymentVerifier({ rpcUrl: config.rpcUrl })

/** In-memory session store: sessionId → { id, amount, currency, returnUrl, intent, status }. */
const sessions = new Map()

/** Mint the payment intent the widget consumes, from a Shopify payment session. */
function buildIntent (session) {
  const amount = String(session.amount)
  const base = BigInt(Math.round(Number(amount) * 10 ** config.decimals)).toString()
  return {
    orderId: 0,
    orderKey: session.id,
    amount,
    amountBase: base,
    decimals: config.decimals,
    tokenAddress: config.token,
    tokenSymbol: config.tokenSymbol,
    chainId: config.chainId,
    chainName: config.chainName,
    chainKey: config.chainKey,
    receivingAddress: config.receiving,
    reference: '0x' + Buffer.from(session.id).toString('hex').padStart(64, '0').slice(-64),
    status: 'pending',
    expiresAt: Math.floor(Date.now() / 1000) + 1800,
    displayTotal: amount,
    currency: session.currency ?? 'USD',
  }
}

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)) }
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => resolve(b)) })

/** The hosted checkout page: mounts the real WDK Pay widget for a session. */
function checkoutPage (session) {
  const cfg = {
    intent: session.intent,
    endpoints: { confirm: `${config.appUrl}/confirm`, status: `${config.appUrl}/status/${session.id}` },
    nonce: session.id,
    returnUrl: session.returnUrl ?? '',
    brand: { name: 'Pay with USDt' },
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay with USDt</title><style>body{margin:0;background:#f6f7f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif}.wrap{max-width:460px;margin:32px auto;padding:0 16px}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.2/ethers.umd.min.js"></script></head>
<body><div class="wrap"><div id="wdk-pay-root" data-wdk-pay="1"></div></div>
<script>window.WDK_PAY=${JSON.stringify(cfg)};</script>
<script src="${config.appUrl}/wdk-checkout.js"></script></body></html>`
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, config.appUrl)

  try {
    // 1) Shopify starts a payment session (HMAC-signed).
    if (req.method === 'POST' && url.pathname === '/payment_sessions') {
      const raw = await readBody(req)
      if (!verifyShopifyHmac(raw, req.headers['x-shopify-hmac-sha256'])) { res.writeHead(401); res.end('bad hmac'); return }
      const p = JSON.parse(raw)
      // Shopify sends id, amount, currency, and a return/redirect URL on the session.
      const session = {
        id: String(p.id ?? p.gid ?? `sess_${Date.now()}`),
        amount: p.amount,
        currency: p.currency,
        returnUrl: p.proposed_at ? p.return_url : (p.return_url ?? p.redirect_url ?? ''),
        status: 'pending',
      }
      session.intent = buildIntent(session)
      sessions.set(session.id, session)
      json(res, 201, { redirect_url: `${config.appUrl}/checkout?session=${encodeURIComponent(session.id)}` })
      return
    }

    // 2) Hosted checkout page (the buyer pays here).
    if (req.method === 'GET' && url.pathname === '/checkout') {
      const session = sessions.get(url.searchParams.get('session'))
      if (!session) { res.writeHead(404); res.end('unknown session'); return }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(checkoutPage(session))
      return
    }

    // 3) Intent JSON (the widget can also be pointed straight here).
    if (req.method === 'GET' && url.pathname === '/intent') {
      const session = sessions.get(url.searchParams.get('session'))
      if (!session) { json(res, 404, { error: 'unknown session' }); return }
      json(res, 200, { intent: session.intent, endpoints: { confirm: `${config.appUrl}/confirm`, status: `${config.appUrl}/status/${session.id}` } })
      return
    }

    // 4) Confirm: verify the transfer on-chain, then resolve/reject the session.
    if (req.method === 'POST' && url.pathname === '/confirm') {
      const { session: id, txHash, chainId } = JSON.parse(await readBody(req))
      const session = sessions.get(id)
      if (!session) { json(res, 404, { status: 'failed', message: 'unknown session' }); return }
      if (session.status === 'confirmed') { json(res, 200, { status: 'confirmed' }); return }

      // The reported chainId must match the configured chain — never verify on an
      // unconfigured chain (the chainId is attacker-controlled).
      if (chainId !== undefined && Number(chainId) !== config.chainId) {
        json(res, 200, { status: 'failed', message: 'unsupported chain' }); return
      }

      const result = await verifier.verify(
        { tokenAddress: config.token, receivingAddress: config.receiving, amountBase: session.intent.amountBase },
        String(txHash),
        config.confirmations,
      )

      if (result.status === 'confirmed') {
        session.status = 'confirmed'
        try { await resolvePaymentSession(session.id) } catch (e) { console.error('[shopify] resolve failed:', e.message) }
        json(res, 200, { status: 'confirmed', returnUrl: session.returnUrl })
        return
      }
      if (result.status === 'failed') {
        try { await rejectPaymentSession(session.id) } catch (e) { console.error('[shopify] reject failed:', e.message) }
        json(res, 200, { status: 'failed', message: result.reason })
        return
      }
      json(res, 200, { status: 'pending', message: result.reason, confirmations: result.confirmations })
      return
    }

    // 5) Status poll.
    if (req.method === 'GET' && url.pathname.startsWith('/status/')) {
      const session = sessions.get(decodeURIComponent(url.pathname.slice('/status/'.length)))
      json(res, 200, { status: session?.status ?? 'unknown' })
      return
    }

    // 6) The widget bundle.
    if (req.method === 'GET' && url.pathname === '/wdk-checkout.js') {
      const js = await readFile(config.widgetBundle, 'utf8')
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(js)
      return
    }

    res.writeHead(404); res.end('not found')
  } catch (err) {
    console.error('[shopify-app]', err)
    json(res, 500, { error: 'internal error' })
  }
})

server.listen(config.port, () => {
  console.log(`WDK Pay Shopify app on :${config.port}`)
  console.log(`  payment sessions → POST ${config.appUrl}/payment_sessions`)
  console.log(`  hosted checkout  → GET  ${config.appUrl}/checkout?session=ID`)
})
