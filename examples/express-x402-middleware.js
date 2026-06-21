/**
 * Express middleware — x402 paywall for API routes (bots / agents / crawlers).
 *
 * Drop this in front of any route you want to charge per request. It answers
 * unpaid requests with HTTP 402 + PaymentRequirements; a client signs an
 * EIP-3009 authorization (x402 "exact" scheme) and retries with an `X-PAYMENT`
 * header, which this middleware verifies off-chain (no keys, no RPC). Settlement
 * is decoupled — submit the signed authorization from a relayer/facilitator with
 * @tetherto/wdk-protocol-eip3009's submitTransferAuthorization() when you want
 * the funds moved on-chain.
 *
 *   import { x402Paywall } from './express-x402-middleware.js';
 *   app.get('/api/data', x402Paywall({
 *     network: 'base', asset: USDC, payTo: MY_ADDRESS,
 *     name: 'USD Coin', price: '10000', // 0.01 USDC
 *   }), (req, res) => res.json({ data: '...' }));
 */
import { buildPaymentRequirements, buildPaymentRequiredResponse, decodePaymentHeader, verifyExactPayment } from 'wdk-checkout/x402';

export function x402Paywall(config) {
  const { network, asset, payTo, name, version = '2', price, maxTimeoutSeconds = 120 } = config;

  return function (req, res, next) {
    const resource = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const requirements = buildPaymentRequirements({
      network, asset, payTo, name, version, maxAmountRequired: price, maxTimeoutSeconds, resource,
    });

    const header = req.get('X-PAYMENT');
    if (!header) {
      return res.status(402).json(buildPaymentRequiredResponse(requirements));
    }

    let payment;
    try {
      payment = decodePaymentHeader(header);
    } catch {
      return res.status(400).json({ error: 'malformed_payment_header' });
    }

    const result = verifyExactPayment(payment, requirements);
    if (!result.isValid) {
      return res.status(402).json(buildPaymentRequiredResponse(requirements, result.invalidReason));
    }

    // Verified. Expose the payer + the signed authorization for optional
    // async settlement, then serve the route.
    req.x402 = { payer: result.payer, payment };
    return next();
  };
}
