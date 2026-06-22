/**
 * Lightning — BOLT11 invoice + poll to settlement.
 *
 * Mint a BOLT11 invoice for the order amount, show it (QR + copyable string),
 * and poll until it's paid — then complete the order. The customer pays from any
 * Lightning wallet (including a WDK Spark wallet).
 *
 * Invoice creation + status come from a pluggable `LightningProvider` you supply.
 * `createLightningClient` wires a GENERIC REST endpoint (Spark / LNbits /
 * LND-REST) with injectable `fetch` and overridable parsers — no node URL or key
 * is hard-coded. This example uses a tiny in-memory provider so it runs offline
 * and deterministically; the production wiring is shown in a comment below.
 *
 * Run:  npx tsx examples/lightning.ts
 */
import {
  createLightningClient,
  satsForFiat,
  formatSats,
  pollInvoice,
  type LightningProvider,
  type LightningInvoice,
  type LightningInvoiceStatus,
} from '@wdk-starter/wdk-checkout/lightning'

// --- Production wiring (commented): a generic REST backend -------------------
//
// const ln = createLightningClient({
//   baseUrl: process.env.LN_BASE_URL!,          // your Spark/LNbits/LND-REST endpoint
//   headers: { 'X-Api-Key': process.env.LN_KEY! },
//   // createPath / statusPath / parseInvoice / parseStatus are overridable per backend.
// })
//
// (referenced so the import is used even with the in-memory demo below)
void createLightningClient

// --- In-memory provider for a runnable demo ----------------------------------
// LightningProvider is a public interface: implement createInvoice + getInvoiceStatus
// over ANY backend. Here we fake one that "pays" the invoice after one poll.
function inMemoryProvider(): LightningProvider {
  const invoices = new Map<string, { invoice: LightningInvoice; polls: number }>()
  return {
    async createInvoice({ amountSats, memo }): Promise<LightningInvoice> {
      const now = Math.floor(Date.now() / 1000)
      const id = `inv_${invoices.size + 1}`
      const invoice: LightningInvoice = {
        id,
        bolt11: `lnbc${amountSats}n1demo${id}`, // opaque payment request (fake)
        amountSats,
        memo,
        createdAt: now,
        expiresAt: now + 3600,
      }
      invoices.set(id, { invoice, polls: 0 })
      return invoice
    },
    async getInvoiceStatus(id): Promise<LightningInvoiceStatus> {
      const rec = invoices.get(id)
      if (!rec) return { id, status: 'expired' }
      rec.polls += 1
      // First check: pending. Subsequent checks: paid (simulates the payer).
      return rec.polls >= 2
        ? { id, status: 'paid', paidAt: Math.floor(Date.now() / 1000), preimage: '0xdeadbeef' }
        : { id, status: 'pending' }
    },
  }
}

async function main() {
  const ln = inMemoryProvider()

  // Size the invoice from a fiat amount + the current BTC price.
  const amountSats = satsForFiat({ fiatAmount: 19.99, btcPriceFiat: 65_000 })
  console.log('amount:', formatSats(amountSats)) // e.g. "30,754 sats"

  const invoice = await ln.createInvoice({ amountSats, memo: 'Order #1234' })
  console.log('show this as a QR + copyable string:', invoice.bolt11)

  // Poll until paid or expired (rejects only on timeout). `now`/`sleep` are
  // injectable; we stub `sleep` here so the demo resolves instantly.
  const result = await pollInvoice({
    provider: ln,
    id: invoice.id,
    intervalMs: 3000,
    timeoutMs: 15 * 60 * 1000,
    onUpdate: (s) => console.log('status:', s.status),
    sleep: async () => {}, // demo only — no real delay
  })

  if (result.status === 'paid') {
    console.log('paid! complete the order. preimage:', result.preimage)
  } else {
    console.log('invoice expired before payment')
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
