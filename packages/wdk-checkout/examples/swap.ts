/**
 * Swap-to-settle — pay any token, merchant receives exactly the order amount in USDt.
 *
 * It's an EXACT-OUTPUT swap: buy exactly `settleAmountBase` of USDt, paying a
 * variable amount of the customer's chosen token, capped by a slippage
 * tolerance. After the swap the merchant receives a plain USDt Transfer, so the
 * gateway's existing on-chain verifier confirms the payment unchanged —
 * swap-to-settle only changes how the customer *funds* it.
 *
 * This module owns the deterministic, exact (BigInt) plan math: input cap,
 * min-receive, deadline. Quoting + on-chain execution are pluggable — you supply
 * a `SwapQuoteProvider` (an adapter over Velora / 0x / 1inch; the WDK wallet
 * bundles @tetherto/wdk-protocol-swap-velora-evm to execute the plan). This
 * example uses a fake provider so it runs offline.
 *
 * Run:  npx tsx examples/swap.ts
 */
import {
  quoteAndPlanSwapToSettle,
  planSwapToSettle,
  type SwapQuoteProvider,
  type SwapQuote,
} from '@wdk-starter/wdk-checkout/swap'

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' // pay token
const USDt = '0xdAC17F958D2ee523a2206206994597C13D831ec7' // settle token (merchant receives)

// Adapter over your aggregator. quoteExactOutput returns the input needed for an
// exact output of the settle token. Here we fake a rate of ~3000 USDt per WETH.
const fakeAggregator: SwapQuoteProvider = {
  async quoteExactOutput({ payToken, settleToken, settleAmountBase, chainId }): Promise<SwapQuote> {
    void chainId
    // 100 USDt out (settleAmountBase "100000000" @ 6dp) ≈ 0.03333 WETH in (18dp).
    const settle = BigInt(settleAmountBase)                 // 1e8 → 100 USDt
    const quotedPayAmountBase = ((settle * 10n ** 18n) / (3000n * 10n ** 6n)).toString()
    return {
      payToken,
      settleToken,
      settleAmountBase,
      quotedPayAmountBase,                                  // ~33333333333333333 wei (~0.0333 WETH)
      route: 'velora:demo-route',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    }
  },
}

async function main() {
  // One call: quote `payToken` → exact USDt output, then build the plan.
  const plan = await quoteAndPlanSwapToSettle({
    provider: fakeAggregator,
    payToken: WETH,
    settleToken: USDt,
    settleAmountBase: '100000000', // exactly 100 USDt to the merchant
    chainId: 1,
    slippageBps: 50,               // 0.5% tolerance on the input
    deadlineSeconds: 600,          // execute within 10 minutes
  })

  console.log('settleAmountBase (exact out merchant gets):', plan.settleAmountBase) // "100000000"
  console.log('quotedPayAmountBase (quoted input):        ', plan.quotedPayAmountBase)
  console.log('maxPayAmountBase  (amountInMax to authorize):', plan.maxPayAmountBase) // quoted + 0.5%
  console.log('minReceiveBase    (= settle; output is exact):', plan.minReceiveBase)
  console.log('deadline (unix seconds):                    ', plan.deadline)
  console.log('slippageBps:                                ', plan.slippageBps)
  console.log('route:                                      ', plan.route)

  // Hand `plan` to the connected wallet to execute the swap + transfer.

  // You can also build a plan from an already-fetched quote (no provider call):
  const quote = await fakeAggregator.quoteExactOutput({
    payToken: WETH, settleToken: USDt, settleAmountBase: '100000000', chainId: 1,
  })
  const plan2 = planSwapToSettle({ quote, chainId: 1, slippageBps: 100, deadlineSeconds: 300 })
  console.log('\nfrom an existing quote → maxPayAmountBase @1%:', plan2.maxPayAmountBase)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
