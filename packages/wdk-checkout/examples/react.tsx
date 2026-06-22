/**
 * React adapter — both usage styles.  Run-context: a React (or React Native)
 * app that has `react` installed.  Import from the `/react` subpath:
 *
 *   import { WdkCheckout, useWdkPayment } from '@wdk-starter/wdk-checkout/react'
 *
 * (a) Drop-in component — mounts the same widget the WooCommerce gateway ships.
 * (b) Headless hook — drive your own UI from typed status/error + actions.
 */

import { WdkCheckout, useWdkPayment } from '@wdk-starter/wdk-checkout/react'
import type { WdkPayConfig } from '@wdk-starter/wdk-checkout'

const config: WdkPayConfig = {
  intent: {
    orderId: 1, orderKey: 'wc_abc', amount: '19.99', amountBase: '19990000',
    decimals: 6, tokenAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', tokenSymbol: 'USDt',
    chainId: 1, chainName: 'Ethereum', chainKey: 'ethereum',
    receivingAddress: '0xMerchantAddress', reference: '0xref', status: 'pending',
    expiresAt: Math.floor(Date.now() / 1000) + 1800,
    displayTotal: '19.99', currency: 'USD',
  },
  endpoints: { confirm: '/confirm', status: '/status' },
  nonce: 'wp-nonce',
  returnUrl: '/order-received',
  theme: { accent: '#0D9488' },
}

/** (a) Drop-in: zero custom UI — the full themeable widget, in React. */
export function DropIn() {
  return <WdkCheckout config={config} style={{ maxWidth: 420, margin: '0 auto' }} />
}

/** (b) Headless: your own buttons, driven by the typed hook. */
export function Headless() {
  const { status, error, txHash, pay, confirmByHash, reset } = useWdkPayment(config)

  if (status === 'confirmed') return <p>Paid ✓ (tx {txHash})</p>

  return (
    <div>
      <button disabled={status !== 'idle' && status !== 'failed'} onClick={() => void pay()}>
        {status === 'idle' || status === 'failed' ? 'Pay with wallet' : `${status}…`}
      </button>

      {/* Branch on the STABLE error code, not message strings. */}
      {error?.code === 'NO_WALLET' && <a href="https://example/install-wdk">Install a wallet →</a>}
      {error?.code === 'WRONG_CHAIN' && <p>Switch your wallet to Ethereum and retry.</p>}
      {error && error.code !== 'NO_WALLET' && error.code !== 'WRONG_CHAIN' && <p role="alert">{error.message}</p>}

      <button onClick={() => void confirmByHash(prompt('Paste tx hash') ?? '')}>Already paid? Confirm by hash</button>
      {error && <button onClick={reset}>Reset</button>}
    </div>
  )
}
