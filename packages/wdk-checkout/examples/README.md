# Examples

Small, runnable examples for `@wdk-starter/wdk-checkout`. Each file has a top
comment explaining what it shows and how to run it. They use the real exported
APIs — nothing is pseudo-code.

```bash
npm install @wdk-starter/wdk-checkout
# ethers is an optional peer — only needed for /x402 and /subscriptions:
npm install ethers
```

| Example | Module | What it shows |
|---|---|---|
| [`mount-widget.html`](./mount-widget.html) | `@wdk-starter/wdk-checkout` | Mount the headless checkout widget with a `PaymentIntent`, endpoints, and a custom `theme`. |
| [`x402-facilitator.ts`](./x402-facilitator.ts) | `@wdk-starter/wdk-checkout/x402` | Verify (and optionally settle) a per-request EIP-3009 payment from the `X-PAYMENT` header. |
| [`pricing.ts`](./pricing.ts) | `@wdk-starter/wdk-checkout/pricing` | Fiat display + exact base-unit conversion via `staticRate` / `endpointRate`. |
| [`subscriptions.ts`](./subscriptions.ts) | `@wdk-starter/wdk-checkout/subscriptions` | Build a recurring per-period EIP-3009 authorization schedule, sign, verify, and find the due charge. |
| [`lightning.ts`](./lightning.ts) | `@wdk-starter/wdk-checkout/lightning` | Mint a BOLT11 invoice and poll to settlement over a pluggable provider. |
| [`swap.ts`](./swap.ts) | `@wdk-starter/wdk-checkout/swap` | Build an exact-output swap-to-settle plan (pay any token, merchant receives USDt). |

## Running the TypeScript examples

The `.ts` examples are written to read top-to-bottom. Run one with any TS
runner, e.g.:

```bash
npx tsx examples/pricing.ts
npx tsx examples/swap.ts
```

`x402-facilitator.ts` and `subscriptions.ts` import `ethers`; install it first.
The HTML example is opened directly in a browser — see its header comment.

> Money note: every amount is a token **base unit** integer string — e.g.
> `10 USDt` at 6 decimals is `"10000000"`. All conversion math is exact
> (BigInt/string), never floating point.
