/**
 * Swap-to-settle — let a customer pay in any token, settle to the merchant in USDt.
 *
 * The merchant needs an exact amount of the settlement token (USDt) to fulfil
 * an order, so this is an **exact-output** swap: buy exactly `settleAmountBase`
 * of USDt, paying a variable amount of the customer's chosen token, capped by a
 * slippage tolerance. After the swap the merchant still receives a plain USDt
 * `Transfer(to=merchant, value ≥ due)` — so the gateway's existing on-chain
 * verifier confirms the payment unchanged; swap-to-settle only changes how the
 * customer *funds* it.
 *
 * This module owns the deterministic, exact (BigInt) plan math — slippage caps,
 * min-receive, deadline. Quoting and on-chain execution are pluggable: supply a
 * {@link SwapQuoteProvider} (e.g. an adapter over `@tetherto/wdk-protocol-swap-velora-evm`,
 * which the WDK wallet already bundles) and the connected wallet executes the
 * swap+transfer. Nothing is hard-coded; no keys live here.
 */

/** A quote: the input needed to receive an exact output of the settle token. */
export interface SwapQuote {
  /** Token the customer pays with (ERC-20 address, or a sentinel for native). */
  readonly payToken: string
  /** Settlement token the merchant receives (e.g. USDt address). */
  readonly settleToken: string
  /** Exact output required, in settle-token base units (decimal string). */
  readonly settleAmountBase: string
  /** Quoted input needed for that exact output, in pay-token base units. */
  readonly quotedPayAmountBase: string
  /** Optional opaque route/aggregator id for execution. */
  readonly route?: string
  /** Optional quote expiry (unix seconds). */
  readonly expiresAt?: number
}

/** Pluggable quote source (Velora/0x/1inch/your aggregator). */
export interface SwapQuoteProvider {
  quoteExactOutput (args: {
    payToken: string
    settleToken: string
    settleAmountBase: string
    chainId: number
  }): Promise<SwapQuote>
}

/** A ready-to-execute swap-to-settle plan with exact, enforced bounds. */
export interface SwapToSettlePlan {
  readonly payToken: string
  readonly settleToken: string
  readonly chainId: number
  /** Exact settlement output the merchant receives (= order amount). */
  readonly settleAmountBase: string
  /** Quoted input for that output. */
  readonly quotedPayAmountBase: string
  /** Max input the customer authorizes = quoted + slippage (the `amountInMax`). */
  readonly maxPayAmountBase: string
  /** Min output enforced (= settleAmountBase; output is exact). */
  readonly minReceiveBase: string
  /** Unix-seconds deadline after which execution must revert. */
  readonly deadline: number
  /** Slippage tolerance applied to the input cap, in basis points. */
  readonly slippageBps: number
  readonly route?: string
}

function asAmount (v: string, label: string): bigint {
  if (!/^\d+$/.test(v)) throw new Error(`swap: ${label} must be an integer base-unit string`)
  return BigInt(v)
}

/** Round an amount UP by `bps` basis points (slippage cap on the input). */
export function applySlippageUp (amountBase: string, bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) throw new Error('swap: slippageBps must be a non-negative integer')
  const a = asAmount(amountBase, 'amountBase')
  const num = a * BigInt(10000 + bps)
  // ceil division by 10000
  return ((num + 9999n) / 10000n).toString()
}

/** Round an amount DOWN by `bps` basis points (slippage floor on an output). */
export function applySlippageDown (amountBase: string, bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) throw new Error('swap: slippageBps must be a non-negative integer')
  const a = asAmount(amountBase, 'amountBase')
  return ((a * BigInt(10000 - bps)) / 10000n).toString()
}

/**
 * Build a swap-to-settle plan from a quote. Pure and exact: computes the input
 * cap (`maxPayAmountBase = quoted + slippage`), pins the exact output, and sets
 * the deadline. Rejects an expired quote or a quote for the wrong output.
 */
export function planSwapToSettle (args: {
  quote: SwapQuote
  chainId: number
  /** Slippage tolerance in basis points (e.g. 50 = 0.5%). */
  slippageBps: number
  /** Seconds until the plan's on-chain deadline. Default 600 (10 min). */
  deadlineSeconds?: number
  /** Override "now" (unix seconds) for deterministic tests. */
  now?: number
}): SwapToSettlePlan {
  const { quote, chainId, slippageBps } = args
  const now = args.now ?? Math.floor(Date.now() / 1000)
  const deadlineSeconds = args.deadlineSeconds ?? 600

  const settle = asAmount(quote.settleAmountBase, 'settleAmountBase')
  if (settle <= 0n) throw new Error('swap: settleAmountBase must be > 0')
  asAmount(quote.quotedPayAmountBase, 'quotedPayAmountBase')
  if (quote.expiresAt !== undefined && now >= quote.expiresAt) throw new Error('swap: quote has expired')
  if (!Number.isInteger(deadlineSeconds) || deadlineSeconds <= 0) throw new Error('swap: deadlineSeconds must be a positive integer')

  return {
    payToken: quote.payToken,
    settleToken: quote.settleToken,
    chainId,
    settleAmountBase: quote.settleAmountBase,
    quotedPayAmountBase: quote.quotedPayAmountBase,
    maxPayAmountBase: applySlippageUp(quote.quotedPayAmountBase, slippageBps),
    minReceiveBase: quote.settleAmountBase,
    deadline: now + deadlineSeconds,
    slippageBps,
    ...(quote.route !== undefined ? { route: quote.route } : {})
  }
}

/**
 * Quote a swap from `payToken` into the exact settlement amount, then build the
 * plan. One call a checkout uses to offer "pay with <token>, we settle in USDt".
 */
export async function quoteAndPlanSwapToSettle (args: {
  provider: SwapQuoteProvider
  payToken: string
  settleToken: string
  settleAmountBase: string
  chainId: number
  slippageBps: number
  deadlineSeconds?: number
  now?: number
}): Promise<SwapToSettlePlan> {
  const quote = await args.provider.quoteExactOutput({
    payToken: args.payToken,
    settleToken: args.settleToken,
    settleAmountBase: args.settleAmountBase,
    chainId: args.chainId
  })
  return planSwapToSettle({
    quote,
    chainId: args.chainId,
    slippageBps: args.slippageBps,
    ...(args.deadlineSeconds !== undefined ? { deadlineSeconds: args.deadlineSeconds } : {}),
    ...(args.now !== undefined ? { now: args.now } : {})
  })
}
