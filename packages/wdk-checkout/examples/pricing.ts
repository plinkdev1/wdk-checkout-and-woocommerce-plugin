/**
 * Pricing — fiat display + exact base-unit conversion.
 *
 * The checkout settles in USDt. By default a store priced in USD maps 1:1 to
 * USDt, so no FX is needed. This module gives you two things:
 *
 *   1. DISPLAY  — format the familiar fiat price (e.g. "$19.99") and the token
 *                 amount for the UI.
 *   2. CONVERT  — turn a fiat-priced order into the exact token base-unit amount
 *                 to settle, using a `RateSource` you supply (no feed is baked
 *                 in). `staticRate` covers 1:1; `endpointRate` wires any JSON
 *                 rate API.
 *
 * All money math is exact (BigInt/string base units) — no float drift on the
 * amount a customer is charged.
 *
 * Run:  npx tsx examples/pricing.ts
 */
import {
  formatFiat,
  formatTokenAmount,
  quoteTokenBase,
  staticRate,
  endpointRate,
  fiatDisplayLine,
} from '@wdk-starter/wdk-checkout/pricing'

async function main() {
  // --- DISPLAY ---------------------------------------------------------------

  // Locale-aware fiat formatting.
  console.log(formatFiat(19.99, 'USD'))          // "$19.99"
  console.log(formatFiat(100, 'EUR', 'de-DE'))   // "100,00 €"

  // Exact base-unit → human token amount ("19990000" @ 6 decimals → "19.99").
  console.log(formatTokenAmount('19990000', 6))                       // "19.99"
  console.log(formatTokenAmount('1234567890', 6, { group: true }))    // "1,234.56789"

  // The widget's fiat line: returns the formatted string, or null when the
  // intent carries no fiat price (a store that prices directly in USDt).
  console.log(fiatDisplayLine({ displayTotal: '19.99', currency: 'USD' })) // "$19.99"
  console.log(fiatDisplayLine({}))                                         // null

  // --- CONVERT: 1:1 store (USD priced, USDt settled) -------------------------

  // staticRate(1) = 1 USDt per 1 USD; no FX call.
  const usd = await quoteTokenBase({
    fiat: { amount: 19.99, currency: 'USD' },
    tokenSymbol: 'USDt',
    tokenDecimals: 6,
    source: staticRate(1),
  })
  console.log(usd) // { rate: 1, amountBase: "19990000" }

  // --- CONVERT: non-1:1 store (EUR priced) -----------------------------------

  // endpointRate wires any JSON feed; {fiat}/{token} in the URL are filled in.
  // `parse` reads the numeric rate out of YOUR feed's response shape; `fetchImpl`
  // is injectable (here we stub it so the example runs offline and deterministically).
  const eurSource = endpointRate('https://your-feed.example/fx?base={fiat}&quote={token}', {
    parse: (j) => (j as { result: number }).result,
    // headers: { authorization: `Bearer ${process.env.FX_KEY}` },
    fetchImpl: async () =>
      new Response(JSON.stringify({ result: 1.08 }), { headers: { 'content-type': 'application/json' } }),
  })

  const eur = await quoteTokenBase({
    fiat: { amount: 100, currency: 'EUR' },
    tokenSymbol: 'USDt',
    tokenDecimals: 6,
    source: eurSource,
  })
  console.log(eur) // { rate: 1.08, amountBase: "108000000" }  (100 EUR → 108 USDt)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
