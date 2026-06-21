/**
 * Subscriptions — recurring payments as a schedule of EIP-3009 authorizations.
 *
 * EIP-3009 `transferWithAuthorization` has no native "recurring" concept, so a
 * subscription is modelled as N independent, pre-authorizable charges, one per
 * billing period. Each charge is a standard TransferWithAuthorization with:
 *
 *   - a **time window** (`validAfter`..`validBefore`) scoped to its period, so
 *     it can only be claimed during that period — not early, not forever, and
 *   - a **unique nonce**, so each period settles exactly once.
 *
 * The customer signs each charge's typed data (one signature per period, or a
 * batch up front); the merchant's relayer submits the due charge on-chain when
 * its window opens. A signed charge is structurally identical to an x402
 * "exact" payment, so it settles through the very same `transferWithAuthorization`
 * path as {@link ./x402.settleExactPayment} — no separate settlement code.
 *
 * Self-custodial throughout: nothing is auto-charged. Each period requires a
 * signature the customer produced, and the window caps how long it is valid.
 */
import { getAddress, keccak256, toUtf8Bytes, verifyTypedData } from 'ethers'

/** EIP-712 types for a TransferWithAuthorization (the EIP-3009 message). */
export const SUBSCRIPTION_TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
}

/** A subscription's terms. Amounts are token base units (decimal strings). */
export interface SubscriptionPlan {
  /** Payer (customer) address. */
  readonly from: string
  /** Merchant receiving address. */
  readonly to: string
  /** EIP-3009 token contract (e.g. USDt). */
  readonly token: string
  /** Numeric EVM chain id. */
  readonly chainId: number
  /** Per-period amount in token base units, e.g. "10000000" for 10 USDt. */
  readonly amountBase: string
  /** Number of billing periods (charges) to schedule. Must be >= 1. */
  readonly periods: number
  /** Billing interval in seconds (e.g. 2592000 ≈ 30 days). Must be > 0. */
  readonly intervalSeconds: number
  /** Unix seconds the first period opens. Defaults to now. */
  readonly startAt?: number
  /**
   * How long each charge stays claimable, in seconds. Defaults to
   * `intervalSeconds` (contiguous, non-overlapping windows). Must be > 0.
   */
  readonly windowSeconds?: number
  /** Optional deterministic nonce seed (e.g. the order key) for idempotency. */
  readonly nonceSeed?: string
}

/** One billing period's authorization template (pre-signature). */
export interface SubscriptionCharge {
  /** 0-based period index. */
  readonly index: number
  readonly from: string
  readonly to: string
  /** Amount in base units (= plan.amountBase). */
  readonly value: string
  /** Unix seconds (string) the charge becomes claimable. */
  readonly validAfter: string
  /** Unix seconds (string) the charge stops being claimable. */
  readonly validBefore: string
  /** Unique bytes32 nonce for this period. */
  readonly nonce: string
}

/** A full subscription schedule: the plan plus its per-period charges. */
export interface SubscriptionSchedule {
  readonly token: string
  readonly chainId: number
  readonly amountBase: string
  readonly charges: readonly SubscriptionCharge[]
}

function requirePositiveInt (n: number, label: string): void {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`subscriptions: ${label} must be a positive integer`)
}

/** Deterministic bytes32 nonce for a period (stable across recomputation). */
function chargeNonce (plan: SubscriptionPlan, index: number): string {
  const seed = plan.nonceSeed ?? ''
  return keccak256(toUtf8Bytes(
    `wdk-sub|${seed}|${getAddress(plan.from)}|${getAddress(plan.to)}|${getAddress(plan.token)}|${plan.chainId}|${index}`
  ))
}

/**
 * Build the schedule of EIP-3009 charges for a subscription plan. Pure and
 * deterministic — the same plan always yields the same windows and nonces, so
 * a merchant and customer can independently recompute it.
 */
export function buildSubscriptionSchedule (plan: SubscriptionPlan): SubscriptionSchedule {
  requirePositiveInt(plan.periods, 'periods')
  requirePositiveInt(plan.intervalSeconds, 'intervalSeconds')
  if (!/^\d+$/.test(plan.amountBase)) throw new Error('subscriptions: amountBase must be an integer base-unit string')
  if (BigInt(plan.amountBase) <= 0n) throw new Error('subscriptions: amountBase must be > 0')

  const from = getAddress(plan.from)
  const to = getAddress(plan.to)
  const token = getAddress(plan.token)
  const start = Math.floor(plan.startAt ?? Date.now() / 1000)
  const window = plan.windowSeconds ?? plan.intervalSeconds
  requirePositiveInt(window, 'windowSeconds')

  const charges: SubscriptionCharge[] = []
  for (let i = 0; i < plan.periods; i++) {
    const validAfter = start + i * plan.intervalSeconds
    const validBefore = validAfter + window
    charges.push({
      index: i,
      from,
      to,
      value: plan.amountBase,
      validAfter: String(validAfter),
      validBefore: String(validBefore),
      nonce: chargeNonce({ ...plan, from, to, token }, i)
    })
  }

  return { token, chainId: plan.chainId, amountBase: plan.amountBase, charges }
}

/** Whether a charge is currently claimable: validAfter <= now < validBefore. */
export function isChargeClaimable (charge: SubscriptionCharge, now: number = Math.floor(Date.now() / 1000)): boolean {
  return Number(charge.validAfter) <= now && now < Number(charge.validBefore)
}

/**
 * The charge whose window currently contains `now` (the one a relayer should
 * settle), or null if no period is open right now.
 */
export function chargeDueAt (
  schedule: SubscriptionSchedule,
  now: number = Math.floor(Date.now() / 1000)
): SubscriptionCharge | null {
  for (const c of schedule.charges) {
    if (isChargeClaimable(c, now)) return c
  }
  return null
}

/** The EIP-712 domain for a token's TransferWithAuthorization. */
export function subscriptionDomain (opts: {
  name: string
  version?: string
  chainId: number
  token: string
}): { name: string, version: string, chainId: number, verifyingContract: string } {
  return {
    name: opts.name,
    version: String(opts.version ?? '2'),
    chainId: opts.chainId,
    verifyingContract: getAddress(opts.token)
  }
}

/**
 * The full EIP-712 typed-data payload the wallet signs to authorize one period.
 * Pass `domain` from {@link subscriptionDomain}.
 */
export function chargeTypedData (
  charge: SubscriptionCharge,
  domain: ReturnType<typeof subscriptionDomain>
): {
  domain: ReturnType<typeof subscriptionDomain>
  types: typeof SUBSCRIPTION_TRANSFER_TYPES
  message: { from: string, to: string, value: string, validAfter: string, validBefore: string, nonce: string }
} {
  return {
    domain,
    types: SUBSCRIPTION_TRANSFER_TYPES,
    message: {
      from: charge.from,
      to: charge.to,
      value: charge.value,
      validAfter: charge.validAfter,
      validBefore: charge.validBefore,
      nonce: charge.nonce
    }
  }
}

/**
 * Verify a customer's signature over a period's charge: recovers the signer and
 * confirms it equals `charge.from`. Off-chain, no keys/RPC — run it before
 * storing the signed authorization for later settlement.
 */
export function verifyChargeSignature (
  charge: SubscriptionCharge,
  signature: string,
  domain: ReturnType<typeof subscriptionDomain>
): boolean {
  const { types, message } = chargeTypedData(charge, domain)
  try {
    const signer = verifyTypedData(domain, types, message, signature)
    return getAddress(signer) === getAddress(charge.from)
  } catch {
    return false
  }
}
