# wdk-checkout

Headless, framework-free **WDK checkout SDK** — self-custodial USDt payments for
ecommerce. Powers the WooCommerce **WDK Pay** gateway and works standalone in any
storefront. The customer pays directly from their own wallet to the merchant; the
SDK never custodies funds.

```bash
npm install @wdk-starter/wdk-checkout
# ethers is an optional peer — only needed for the /x402 and /subscriptions subpaths:
npm install ethers
```

## Mount the widget

```ts
import { mountCheckout } from '@wdk-starter/wdk-checkout'

const teardown = mountCheckout(document.getElementById('checkout')!, {
  intent: {
    orderId: 1, orderKey: 'wc_abc', amount: '19.99', amountBase: '19990000',
    decimals: 6, tokenAddress: '0x…', tokenSymbol: 'USDt',
    chainId: 1, chainName: 'Ethereum', chainKey: 'ethereum',
    receivingAddress: '0x…', reference: '0x…', status: 'pending',
    expiresAt: Math.floor(Date.now() / 1000) + 1800,
    // optional fiat display:
    displayTotal: '19.99', currency: 'USD',
  },
  endpoints: { confirm: '/confirm', status: '/status' },
  nonce: '…', returnUrl: '/order-received',
  // optional: re-skin to your storefront
  theme: { accent: '#0D9488', surface: '#0B1F1C', onSurface: '#E6FFFA', radius: '10px' },
})
```

The widget is fully themeable via a `CheckoutTheme` palette (injected as CSS
variables). Connect a wallet and pay, or pay manually and confirm by tx hash.

## Subpath modules

| Import | What it is |
|---|---|
| `@wdk-starter/wdk-checkout` | the checkout widget (`mountCheckout`, `payIntent`, `DEFAULT_CHECKOUT_THEME`, types) |
| `@wdk-starter/wdk-checkout/x402` | x402 facilitator — verify/settle per-request EIP-3009 payments (charge bots/agents) |
| `@wdk-starter/wdk-checkout/pricing` | fiat display + exact base-unit conversion, pluggable `RateSource` |
| `@wdk-starter/wdk-checkout/swap` | swap-to-settle plan math (pay any token, merchant receives USDt) |
| `@wdk-starter/wdk-checkout/subscriptions` | recurring payments as per-period EIP-3009 authorizations |
| `@wdk-starter/wdk-checkout/lightning` | BOLT11 invoice + poll-to-settlement (`LightningProvider`) — generic REST, or `createSparkLightningProvider` to receive into your own WDK Spark wallet |
| `@wdk-starter/wdk-checkout/react` | optional React/RN adapter — `<WdkCheckout>` drop-in + `useWdkPayment` headless hook (typed `CheckoutError`s + state machine). `react` is an optional peer. |

The ecommerce-rail modules (`pricing`/`swap`/`subscriptions`/`lightning`) are
config-driven — you supply the rate feed / DEX quote / Lightning endpoint; no keys
are hard-coded. `x402` and `subscriptions` use `ethers` (optional peer).

## Docs

Full documentation, the WooCommerce plugin, architecture, security model, and
copy-paste rail wiring live in the
[repository](https://github.com/plinkdev1/wdk-checkout-and-woocommerce-plugin) —
see [`docs/ECOMMERCE_RAILS.md`](https://github.com/plinkdev1/wdk-checkout-and-woocommerce-plugin/blob/main/docs/ECOMMERCE_RAILS.md).

## License

[MIT](https://github.com/plinkdev1/wdk-checkout-and-woocommerce-plugin/blob/main/LICENSE).
Built with [Tether WDK](https://docs.wallet.tether.io). A community reference
implementation; not an official Tether product.
