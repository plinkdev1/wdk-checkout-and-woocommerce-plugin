/**
 * Subscriptions — recurring payments as a schedule of EIP-3009 authorizations.
 *
 * EIP-3009 `transferWithAuthorization` has no native "recurring" concept, so a
 * subscription is modelled as N independent, pre-authorizable charges — one per
 * billing period. Each charge has:
 *   - a TIME WINDOW (validAfter..validBefore) scoped to its period, so it can
 *     only be claimed during that period (not early, not forever), and
 *   - a UNIQUE NONCE, so each period settles exactly once.
 *
 * Self-custodial: nothing auto-charges. The customer SIGNS each period's typed
 * data; the merchant verifies the signature off-chain, stores it, and a relayer
 * submits the due charge on-chain when its window opens — through the SAME
 * transferWithAuthorization path as x402 (see x402 settleExactPayment).
 *
 * Run:  npx tsx examples/subscriptions.ts   (requires `ethers`)
 */
import { Wallet } from 'ethers'
import {
  buildSubscriptionSchedule,
  subscriptionDomain,
  chargeTypedData,
  verifyChargeSignature,
  chargeDueAt,
} from '@wdk-starter/wdk-checkout/subscriptions'

const USDt = '0xdAC17F958D2ee523a2206206994597C13D831ec7' // Ethereum mainnet USDt
const merchant = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

async function main() {
  // A throwaway customer wallet to demonstrate signing/verifying the round-trip.
  const customer = Wallet.createRandom()

  // 1) MERCHANT builds the schedule. Pure + deterministic — the same plan always
  //    yields the same windows and nonces, so customer and merchant can each
  //    recompute it independently. `startAt` is fixed here for a reproducible demo.
  const startAt = Math.floor(Date.now() / 1000)
  const schedule = buildSubscriptionSchedule({
    from: customer.address,
    to: merchant,
    token: USDt,
    chainId: 1,
    amountBase: '10000000',         // 10 USDt per period @ 6 decimals
    periods: 12,                    // 12 charges
    intervalSeconds: 2_592_000,     // ~30 days
    startAt,
    nonceSeed: 'wc_order_demo1234', // optional idempotency seed (e.g. the order key)
  })
  console.log('periods scheduled:', schedule.charges.length) // 12

  // 2) CUSTOMER signs each period's typed data (one signature per charge — or a
  //    batch up front). Here we sign the first period.
  const domain = subscriptionDomain({ name: 'Tether USD', version: '2', chainId: 1, token: USDt })
  const first = schedule.charges[0]
  const { types, message } = chargeTypedData(first, domain)
  const signature = await customer.signTypedData(domain, types, message)

  // 3) MERCHANT verifies off-chain before storing the signed authorization.
  const ok = verifyChargeSignature(first, signature, domain)
  console.log('signature valid:', ok) // true

  // A signature from someone else must NOT verify.
  const wrong = await Wallet.createRandom().signTypedData(domain, types, message)
  console.log('forged signature valid:', verifyChargeSignature(first, wrong, domain)) // false

  // 4) When a period opens, find the charge whose window contains "now" and
  //    settle it via the same transferWithAuthorization path as x402.
  const dueNow = chargeDueAt(schedule)                  // uses real now → period 0 is open
  console.log('charge due now (index):', dueNow?.index) // 0

  // chargeDueAt accepts an explicit `now` (unix seconds) — handy for tests and
  // for checking a future period. Here we peek into period 1's window.
  const inPeriod1 = startAt + 2_592_000 + 10
  console.log('charge due in period 1 (index):', chargeDueAt(schedule, inPeriod1)?.index) // 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
