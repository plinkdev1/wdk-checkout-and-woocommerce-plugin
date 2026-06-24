# Ecommerce rails

Beyond a plain self-custodial USDt transfer, `@wdk-starter/wdk-checkout` ships four optional
**rails** as small, config-driven SDK modules. Each one is a *seam*: you supply
the price feed / DEX quote / Lightning endpoint, and nothing is hard-coded. They
are framework-free TypeScript and import on demand, so they don't bloat the
checkout widget bundle.

| Rail | Import | What it does |
|---|---|---|
| Fiat pricing | `@wdk-starter/wdk-checkout/pricing` | Show the fiat price; convert fiat → token at a rate you supply |
| Swap-to-settle | `@wdk-starter/wdk-checkout/swap` | Customer pays any token; merchant receives exactly the order amount in USDt |
| Subscriptions | `@wdk-starter/wdk-checkout/subscriptions` | Recurring payments as per-period EIP-3009 authorizations |
| Lightning | `@wdk-starter/wdk-checkout/lightning` | BOLT11 invoice + poll to settlement — generic REST (Spark / LNbits / LND-REST) **or** straight into your own Spark wallet (`createSparkLightningProvider`) |

All amounts are **base units** (integer strings) — e.g. `10 USDt` is `"10000000"`
at 6 decimals — and all money math is exact (BigInt/string), never floating point.

---

## Fiat pricing — `@wdk-starter/wdk-checkout/pricing`

The widget already shows the store-currency price when the payment intent carries
`displayTotal` + `currency` (the WooCommerce plugin fills these in). The module is
for the conversion side: turning a fiat-priced order into a settlement amount when
the store currency isn't 1:1 with USDt.

```ts
import { quoteTokenBase, staticRate, endpointRate } from '@wdk-starter/wdk-checkout/pricing'

// 1:1 store (USD priced, USDt settled) — no FX needed:
const usd = await quoteTokenBase({
  fiat: { amount: 19.99, currency: 'USD' },
  tokenSymbol: 'USDt', tokenDecimals: 6, source: staticRate(1),
})
// usd.amountBase === "19990000"

// Non-1:1 store (EUR priced) — wire any JSON rate feed; {fiat}/{token} are filled in.
// `parse` reads the rate out of YOUR feed's response shape; fetch is injectable.
const eurSource = endpointRate('https://your-feed.example/fx?base={fiat}&quote={token}', {
  parse: (j) => (j as { result: number }).result,
  headers: { authorization: `Bearer ${process.env.FX_KEY}` },
})
const eur = await quoteTokenBase({
  fiat: { amount: 100, currency: 'EUR' }, tokenSymbol: 'USDt', tokenDecimals: 6, source: eurSource,
})
```

`@tetherto/wdk-pricing-*` is not published yet; when it is, implement the one-method
`RateSource` interface over it and pass it as `source`.

---

## Swap-to-settle — `@wdk-starter/wdk-checkout/swap`

Accept any token, settle the merchant in USDt. It's an **exact-output** swap: the
merchant gets exactly the order amount; the customer pays a variable input capped
by slippage. After the swap the merchant receives a normal USDt `Transfer`, so the
gateway's existing on-chain verifier confirms it unchanged.

```ts
import { quoteAndPlanSwapToSettle, type SwapQuoteProvider } from '@wdk-starter/wdk-checkout/swap'

// Adapter over your aggregator (Velora / 0x / 1inch). The WDK wallet bundles
// @tetherto/wdk-protocol-swap-velora-evm to execute the resulting plan.
const velora: SwapQuoteProvider = {
  async quoteExactOutput({ payToken, settleToken, settleAmountBase, chainId }) {
    const q = await myVeloraClient.quoteBuy({ src: payToken, dest: settleToken, destAmount: settleAmountBase, chainId })
    return { payToken, settleToken, settleAmountBase, quotedPayAmountBase: q.srcAmount, route: q.id, expiresAt: q.deadline }
  },
}

const plan = await quoteAndPlanSwapToSettle({
  provider: velora,
  payToken: WETH, settleToken: USDt, settleAmountBase: '100000000', // 100 USDt
  chainId: 1, slippageBps: 50, deadlineSeconds: 600,
})
// plan.settleAmountBase  → exact output the merchant receives
// plan.maxPayAmountBase   → amountInMax the customer authorizes (quoted + 0.5%)
// plan.deadline           → execute-before unix seconds
// Hand `plan` to the connected wallet to execute the swap + transfer.
```

---

## Subscriptions — `@wdk-starter/wdk-checkout/subscriptions`

A subscription is a **schedule of EIP-3009 authorizations**, one per billing
period. Each charge has its own time-boxed `validAfter`..`validBefore` window and a
unique nonce, so a period can only be claimed during that period and exactly once.
Self-custodial: nothing auto-charges without a customer signature.

```ts
import {
  buildSubscriptionSchedule, subscriptionDomain, chargeTypedData,
  verifyChargeSignature, chargeDueAt,
} from '@wdk-starter/wdk-checkout/subscriptions'

// 1) Merchant builds the schedule (deterministic — recomputable from the plan):
const schedule = buildSubscriptionSchedule({
  from: customer, to: merchant, token: USDt, chainId: 1,
  amountBase: '10000000', periods: 12, intervalSeconds: 2_592_000, // 10 USDt × 12 months
  nonceSeed: orderKey,
})

// 2) Customer signs each period's typed data (one signature per charge):
const domain = subscriptionDomain({ name: 'Tether USD', version: '2', chainId: 1, token: USDt })
const { types, message } = chargeTypedData(schedule.charges[0], domain)
const signature = await wallet.signTypedData(domain, types, message)

// 3) Merchant verifies off-chain and stores the signed authorization:
verifyChargeSignature(schedule.charges[0], signature, domain) // → true

// 4) When a period opens, settle the due charge via the SAME transferWithAuthorization
//    path as x402 (see wdk-checkout/x402 settleExactPayment):
const due = chargeDueAt(schedule) // the charge whose window contains "now", or null
```

---

## Lightning (Spark) — `@wdk-starter/wdk-checkout/lightning`

Mint a BOLT11 invoice for the order and poll until it's paid. Backends are
pluggable; `createLightningClient` wires a generic REST endpoint (Spark, LNbits,
LND-REST). No node URL or key is hard-coded.

```ts
import { createLightningClient, satsForFiat, pollInvoice } from '@wdk-starter/wdk-checkout/lightning'

const ln = createLightningClient({
  baseUrl: process.env.LN_BASE_URL!,            // your Spark/LNbits endpoint
  headers: { 'X-Api-Key': process.env.LN_KEY! },
  // statusPath / parseInvoice / parseStatus are overridable per backend.
})

const amountSats = satsForFiat({ fiatAmount: 19.99, btcPriceFiat: 65_000 })
const invoice = await ln.createInvoice({ amountSats, memo: `Order #${orderId}` })
// → show invoice.bolt11 as a QR + copyable string

const result = await pollInvoice({ provider: ln, id: invoice.id, intervalMs: 3000, timeoutMs: 900_000 })
if (result.status === 'paid') completeOrder(orderId)
```

The customer pays from any Lightning wallet, including a WDK Spark wallet.

### Accept straight into your own Spark wallet (self-custodial, no LN service)

`createSparkLightningProvider` adapts a WDK Spark account to the same
`LightningProvider` interface — the merchant receives Lightning payments directly
into their own Spark wallet, with no third-party node. The account is typed
through a narrow local interface, so this package imports **no** Spark SDK; you
construct the account and hand it in.

```ts
import { createSparkLightningProvider, satsForFiat, pollInvoice } from '@wdk-starter/wdk-checkout/lightning'
import WalletManagerSpark from '@tetherto/wdk-wallet-spark'

const account = await new WalletManagerSpark(process.env.MERCHANT_SEED!).getAccount(0)
const ln = createSparkLightningProvider(account) // satisfies LightningProvider

const invoice = await ln.createInvoice({ amountSats: satsForFiat({ fiatAmount: 19.99, btcPriceFiat: 65_000 }), memo: `Order #${orderId}` })
const result = await pollInvoice({ provider: ln, id: invoice.id })
if (result.status === 'paid') completeOrder(orderId)
```

Status mapping tolerates the SDK's `LightningReceiveRequest` status strings (a
recovered preimage / completed transfer = paid); override with `{ mapStatus }` if
your build differs.

---

Every rail is unit-tested in `packages/wdk-checkout/src/*.spec.ts`. See
[`ROADMAP.md`](../ROADMAP.md) for status and what's still sequenced.
