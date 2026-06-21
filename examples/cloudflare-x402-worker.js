/**
 * Cloudflare Worker — x402 paywall for AI bots / crawlers / scrapers.
 *
 * Deploy this as a reverse proxy in front of an origin (e.g. a Netlify site
 * proxied through Cloudflare). It lets real humans and verified search engines
 * (Google/Bing) through untouched, and challenges AI training bots with an
 * HTTP 402 "Payment Required" using the x402 protocol. Bots equipped with an
 * x402 agent wallet sign an EIP-3009 USDC/USDt authorization and retry with an
 * `X-PAYMENT` header; this Worker verifies the signature at the edge (no keys,
 * no RPC) and forwards paid requests to the origin.
 *
 * Settlement (moving funds on-chain) is intentionally decoupled: verifying the
 * signature is enough to gate access cheaply, and the signed authorization can
 * be settled asynchronously by your backend/relayer or an external facilitator
 * via @tetherto/wdk-protocol-eip3009's submitTransferAuthorization(). Funds go
 * straight to YOUR address (`PAY_TO`) — no private key ever touches this Worker.
 *
 * Build: `npm i wdk-checkout` and bundle with Wrangler (it tree-shakes ethers).
 *
 * Config (wrangler.toml [vars] or dashboard):
 *   PAY_TO            your receiving 0x address (revenue destination)
 *   X402_NETWORK      e.g. "base" (cheap) or "ethereum" / "polygon" / "arbitrum"
 *   X402_ASSET        USDC/USDt contract on that network
 *   X402_ASSET_NAME   the token's EIP-712 domain name (e.g. "USD Coin")
 *   X402_ASSET_VERSION the token's EIP-712 domain version (e.g. "2")
 *   X402_PRICE        price per request, in token base units (e.g. "10000" = 0.01)
 */

import {
  buildPaymentRequirements,
  buildPaymentRequiredResponse,
  decodePaymentHeader,
  verifyExactPayment,
} from 'wdk-checkout/x402';

// Known AI training/scraper user-agents to paywall.
const AI_BOT_RE = /GPTBot|ClaudeBot|anthropic-ai|PerplexityBot|Google-Extended|OAI-SearchBot|CCBot|Bytespider|Amazonbot|omgili|ImagesiftBot|Diffbot|cohere-ai/i;
// Search engines we let through for SEO.
const SEARCH_RE = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot/i;

function requirementsFor(env, resource) {
  return buildPaymentRequirements({
    network: env.X402_NETWORK || 'base',
    asset: env.X402_ASSET,
    payTo: env.PAY_TO,
    maxAmountRequired: env.X402_PRICE || '10000',
    name: env.X402_ASSET_NAME || 'USD Coin',
    version: env.X402_ASSET_VERSION || '2',
    resource,
    description: 'Per-request access for automated clients.',
    maxTimeoutSeconds: 120,
  });
}

export default {
  async fetch(request, env) {
    const ua = request.headers.get('user-agent') || '';
    const bot = request.cf?.botManagement;

    // 1) Humans pass through untouched (Cloudflare score: 1 = bot, 99 = human).
    if (typeof bot?.score === 'number' && bot.score > 30) return fetch(request);

    // 2) Verified good search engines pass through (protect SEO).
    if (bot?.verifiedBot === true || SEARCH_RE.test(ua)) return fetch(request);

    // 3) Only paywall traffic that looks like an AI scraper.
    const isAiBot = AI_BOT_RE.test(ua) || (typeof bot?.score === 'number' && bot.score <= 30);
    if (!isAiBot) return fetch(request);

    const requirements = requirementsFor(env, new URL(request.url).toString());
    const paymentHeader = request.headers.get('X-PAYMENT');

    // 3a) No payment yet → issue the 402 challenge.
    if (!paymentHeader) {
      return new Response(JSON.stringify(buildPaymentRequiredResponse(requirements)), {
        status: 402,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 3b) Verify the signed authorization at the edge.
    try {
      const payment = decodePaymentHeader(paymentHeader);
      const result = verifyExactPayment(payment, requirements);
      if (!result.isValid) {
        return new Response(JSON.stringify({ error: result.invalidReason }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // (Optional) settle asynchronously: hand `payment` to your backend/relayer
      // or a facilitator to submit transferWithAuthorization on-chain.
      // ctx.waitUntil(fetch(env.FACILITATOR_URL, { method: 'POST', body: paymentHeader }));

      return fetch(request); // paid → serve the origin content
    } catch {
      return new Response('Malformed X-PAYMENT', { status: 400 });
    }
  },
};
