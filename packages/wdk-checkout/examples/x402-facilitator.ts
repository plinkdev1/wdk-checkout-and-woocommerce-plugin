/**
 * x402 facilitator — verify (and optionally settle) a per-request payment.
 *
 * This is the server/payee side of HTTP "402 Payment Required": you charge a
 * client (a bot, crawler, or AI agent) per request. The flow:
 *
 *   1. No payment yet  → answer 402 with PaymentRequirements (the "accepts" list).
 *   2. Client signs an EIP-3009 authorization (the x402 "exact" scheme) and
 *      retries with an `X-PAYMENT` header (base64 JSON).
 *   3. You DECODE + VERIFY the header off-chain — verifyExactPayment recovers the
 *      signer with no keys and no RPC, so it is safe at the edge.
 *   4. (Optional) SETTLE on-chain via a relayer so the funds actually move; the
 *      payer's signature is gasless, your relayer pays gas.
 *
 * Verifying is enough to GATE ACCESS cheaply; settlement is a separate step you
 * can run from a backend/relayer or delegate to an external facilitator.
 *
 * Run:  npx tsx examples/x402-facilitator.ts   (requires `ethers`)
 *
 * See also the repo-level examples/express-x402-middleware.js and
 * examples/cloudflare-x402-worker.js for framework wiring.
 */
import {
  buildPaymentRequirements,
  buildPaymentRequiredResponse,
  decodePaymentHeader,
  verifyExactPayment,
  settleExactPayment,
} from '@wdk-starter/wdk-checkout/x402'

// The PaymentRequirements for the protected resource. One entry of the 402
// `accepts` array, for the EIP-3009 "exact" scheme. `network` is an x402 network
// name (mapped to a chain id internally); `maxAmountRequired` is base units.
const requirements = buildPaymentRequirements({
  network: 'base',                                        // cheap L2; also 'ethereum' | 'polygon' | 'arbitrum' | …
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',    // USDC on Base
  payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',    // YOUR receiving address
  maxAmountRequired: '10000',                             // 0.01 USDC @ 6 decimals
  name: 'USD Coin',                                       // token EIP-712 domain name
  version: '2',                                           // token EIP-712 domain version
  resource: 'https://api.example.com/articles/42',
  description: 'Per-request access for automated clients.',
  maxTimeoutSeconds: 120,
})

/**
 * Handle one incoming request. `xPaymentHeader` is the value of the client's
 * `X-PAYMENT` header (or undefined if absent). Returns what you'd send back.
 */
async function handleRequest(xPaymentHeader: string | undefined): Promise<{
  status: number
  body: unknown
}> {
  // 1) No payment → issue the 402 challenge.
  if (!xPaymentHeader) {
    return { status: 402, body: buildPaymentRequiredResponse(requirements) }
  }

  // 2) Decode the base64-JSON X-PAYMENT header.
  let payment
  try {
    payment = decodePaymentHeader(xPaymentHeader)
  } catch {
    return { status: 400, body: { error: 'malformed_payment_header' } }
  }

  // 3) Verify off-chain (recovers the signer; checks scheme/network/recipient/
  //    amount/validity). No keys, no RPC.
  const result = verifyExactPayment(payment, requirements)
  if (!result.isValid) {
    // result.invalidReason is e.g. 'insufficient_amount' | 'expired' | 'bad_signature'.
    return { status: 402, body: buildPaymentRequiredResponse(requirements, result.invalidReason ?? undefined) }
  }

  // Verified — `result.payer` is the recovered payer address. This alone is
  // enough to serve the resource. Settlement below is optional.

  // 4) (Optional) Settle on-chain so the funds actually move. A relayer pays the
  //    gas; the payer's signature is gasless. Keep the relayer key server-side.
  if (process.env.SETTLE === '1') {
    const { txHash, payer } = await settleExactPayment(payment, requirements, {
      rpcUrl: process.env.RPC_URL!,                 // JSON-RPC for the payment's network
      relayerPrivateKey: process.env.RELAYER_KEY!,  // pays gas — NEVER the payer's key
    })
    console.log('settled on-chain:', { txHash, payer })
  }

  return { status: 200, body: { ok: true, payer: result.payer, data: '…protected content…' } }
}

// --- demo: show the 402 challenge a client would receive first ---
async function main() {
  const challenge = await handleRequest(undefined)
  console.log('challenge status:', challenge.status) // 402
  console.log('accepts:', JSON.stringify(challenge.body, null, 2))
  // A real client would now sign an EIP-3009 authorization for one of the
  // `accepts` entries and retry with the X-PAYMENT header, which handleRequest
  // would decode → verify → (optionally) settle.
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
