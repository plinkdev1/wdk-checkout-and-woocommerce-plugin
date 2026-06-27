/**
 * Generic merchant backend (Phase 4 item 8) — the SAME framework-free core that
 * backs the WooCommerce plugin, used off WooCommerce. A dependency-free Node HTTP
 * server that:
 *
 *   GET  /intent?order=ID&amount=19.99   → a payment intent for the checkout widget
 *   POST /webhook   (X-WDK-Signature)     → verify a signed payment-status webhook
 *
 * Drop the widget on any page (one tag, the <wdk-pay> Web Component, or
 * mountCheckout) pointed at /intent; receive paid/failed/refunded events at
 * /webhook. No WooCommerce, no framework — Shopify/Magento/custom all wire the
 * same way.
 *
 * Run:  WDK_WEBHOOK_SECRET=shh node examples/merchant-server.mjs
 */
import { createServer } from 'node:http'
import { satsForFiat } from '@wdk-starter/wdk-checkout/lightning'
import { verifyWebhook, WEBHOOK_SIGNATURE_HEADER } from '@wdk-starter/wdk-checkout'

const SECRET = process.env.WDK_WEBHOOK_SECRET ?? 'dev-secret'
const RECEIVING = process.env.WDK_RECEIVING ?? '0x0000000000000000000000000000000000000000'
const TOKEN = process.env.WDK_TOKEN ?? '0xdAC17F958D2ee523a2206206994597C13D831ec7' // USDt (Ethereum)

/** Mint a payment intent for an order — the object the checkout widget consumes. */
function buildIntent (orderId, amount) {
  const base = BigInt(Math.round(Number(amount) * 1e6)).toString() // USDt = 6 decimals
  return {
    orderId: Number(orderId),
    orderKey: `key_${orderId}`,
    amount: String(amount),
    amountBase: base,
    decimals: 6,
    tokenAddress: TOKEN,
    tokenSymbol: 'USDt',
    chainId: 1,
    chainName: 'Ethereum',
    chainKey: 'ethereum',
    receivingAddress: RECEIVING,
    reference: `0x${orderId.toString(16).padStart(64, '0')}`,
    status: 'pending',
    expiresAt: Math.floor(Date.now() / 1000) + 1800,
    displayTotal: String(amount),
    currency: 'USD',
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (req.method === 'GET' && url.pathname === '/intent') {
    const order = url.searchParams.get('order') ?? '1'
    const amount = url.searchParams.get('amount') ?? '19.99'
    // (Lightning option: satsForFiat({ fiatAmount: amount, btcPriceFiat: 65000 }).)
    void satsForFiat
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    res.end(JSON.stringify({ intent: buildIntent(order, amount), endpoints: { confirm: '/confirm', status: `/status/${order}` } }))
    return
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', async () => {
      const sig = req.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()] ?? ''
      // IMPORTANT: verify over the RAW received body bytes.
      const ok = await verifyWebhook(SECRET, body, String(sig))
      if (!ok) { res.writeHead(401); res.end('bad signature'); return }
      const event = JSON.parse(body)
      console.log(`[webhook] ${event.type} for order ${event.orderId} (${event.status})`)
      // → mark the order paid/failed/refunded in your store here.
      res.writeHead(200); res.end('ok')
    })
    return
  }

  res.writeHead(404); res.end('not found')
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => console.log(`WDK merchant core listening on :${port}  (GET /intent, POST /webhook)`))
