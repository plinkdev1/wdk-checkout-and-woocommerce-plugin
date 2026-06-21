# wdk-payment-verifier

Server-side, **read-only** on-chain confirmation for self-custodial **WDK Pay**
payments. A payment is a plain ERC-20 transfer of the settlement token (USDt) to
the merchant; this library confirms one landed — `Transfer(token, to = merchant,
value ≥ due)` with N confirmations — over JSON-RPC. No keys, no custody: the
merchant only *watches* the chain. It's the Node/headless counterpart to the
WooCommerce plugin's PHP verifier.

```bash
npm install wdk-payment-verifier
```

## Verify a known transaction

```ts
import { PaymentVerifier } from 'wdk-payment-verifier'

const verifier = new PaymentVerifier({ rpcUrl: process.env.RPC_URL! })

const result = await verifier.verify(
  { tokenAddress: USDt, receivingAddress: merchant, amountBase: '19990000' }, // 19.99 USDt
  txHash,
  /* requiredConfirmations */ 5,
)
// result.status: 'confirmed' | 'pending' | 'failed'
if (result.status === 'confirmed') markOrderPaid(result)
```

## Watch for an incoming payment (no hash yet)

```ts
const result = await verifier.watch(
  { tokenAddress: USDt, receivingAddress: merchant, amountBase: '19990000' },
  { requiredConfirmations: 5, timeoutMs: 15 * 60_000, pollIntervalMs: 5000 },
)
```

`watch` polls `eth_getLogs` for a matching Transfer to the recipient, then waits
for confirmations; it resolves `confirmed`/`failed`, or `pending` (reason
`timeout`) if the window elapses.

## Pluggable provider

Pass `rpcUrl` (an ethers `JsonRpcProvider` is created lazily), an existing
`provider`, or — for tests — any object implementing the minimal `EvmReadProvider`
interface (`getTransactionReceipt`, `getBlockNumber`, `getLogs`). Nothing is
hard-coded.

`PaymentConfirmation` carries `status`, `txHash`, `blockNumber`, `confirmations`,
`valueBase`, and `fromAddress` so your order system has everything to reconcile.

## License

[MIT](https://github.com/plinkdev1/wdk-checkout-and-woocommerce-plugin/blob/main/LICENSE).
Built with [Tether WDK](https://docs.wallet.tether.io); not an official Tether product.
