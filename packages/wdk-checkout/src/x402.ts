/**
 * x402 facilitator — the server/payee side of HTTP "402 Payment Required".
 *
 * Use this to charge clients (AI bots, crawlers, agents) per request. The server
 * answers 402 with PaymentRequirements; a client signs an EIP-3009
 * authorization (the x402 "exact" scheme) and retries with an `X-PAYMENT`
 * header; this module decodes and **verifies** that payment (recovers the signer
 * off-chain — no keys, no RPC, edge-friendly). Settlement (submitting the
 * authorization on-chain) is a separate step you can run from a backend/relayer
 * or delegate to an external facilitator.
 *
 * Pairs with the WDK wallet's x402 client (which produces the X-PAYMENT header)
 * and @tetherto/wdk-protocol-eip3009 (the on-chain settlement primitive).
 */
import { verifyTypedData, getAddress } from 'ethers';

export const X402_VERSION = 1;
export const SCHEME_EXACT = 'exact';

/** Common x402 network name → EVM chain id. */
export const NETWORK_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  'base-sepolia': 84532,
  polygon: 137,
  'polygon-amoy': 80002,
  arbitrum: 42161,
  optimism: 10,
  avalanche: 43114,
  'avalanche-fuji': 43113,
  sepolia: 11155111,
};

export function networkToChainId(network: string | number): number {
  if (typeof network === 'number') return network;
  const id = NETWORK_CHAIN_IDS[String(network).toLowerCase()];
  if (!id) throw new Error(`Unknown x402 network: ${network}`);
  return id;
}

export interface X402Requirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

export interface X402Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface X402Payment {
  x402Version: number;
  scheme: string;
  network: string;
  payload: { signature: string; authorization: X402Authorization };
}

export interface VerifyResult {
  isValid: boolean;
  payer: string | null;
  invalidReason: string | null;
}

const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/**
 * Build a PaymentRequirements entry (one item of the 402 `accepts` array) for
 * the EIP-3009 "exact" scheme.
 */
export function buildPaymentRequirements(o: {
  network: string;
  asset: string;
  payTo: string;
  maxAmountRequired: string | number | bigint;
  resource?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  name: string;
  version?: string;
}): X402Requirements {
  if (!o.asset) throw new Error("'asset' (token address) is required.");
  if (!o.payTo) throw new Error("'payTo' (recipient) is required.");
  if (o.maxAmountRequired === undefined || o.maxAmountRequired === null) throw new Error("'maxAmountRequired' is required.");
  return {
    scheme: SCHEME_EXACT,
    network: String(o.network),
    maxAmountRequired: String(o.maxAmountRequired),
    resource: o.resource ?? '',
    description: o.description ?? '',
    mimeType: o.mimeType ?? 'application/json',
    payTo: getAddress(o.payTo),
    maxTimeoutSeconds: o.maxTimeoutSeconds ?? 60,
    asset: getAddress(o.asset),
    extra: { name: o.name ?? '', version: String(o.version ?? '2') },
  };
}

/** The full 402 response body. */
export function buildPaymentRequiredResponse(accepts: X402Requirements | X402Requirements[], error = 'X-PAYMENT header is required'): { x402Version: number; accepts: X402Requirements[]; error: string } {
  return { x402Version: X402_VERSION, accepts: Array.isArray(accepts) ? accepts : [accepts], error };
}

/** Decode an `X-PAYMENT` header value (base64 JSON). */
export function decodePaymentHeader(headerValue: string): X402Payment {
  if (typeof headerValue !== 'string' || headerValue === '') throw new Error('Empty X-PAYMENT header.');
  const json = typeof Buffer !== 'undefined'
    ? Buffer.from(headerValue.trim(), 'base64').toString('utf8')
    : decodeURIComponent(escape(atob(headerValue.trim())));
  try {
    return JSON.parse(json) as X402Payment;
  } catch {
    throw new Error('Malformed X-PAYMENT header (expected base64-encoded JSON).');
  }
}

/**
 * Verify an x402 "exact" payment against requirements (off-chain). Recovers the
 * EIP-3009 signer and checks scheme, network, recipient, amount, and validity.
 * No keys or RPC needed — safe to run at the edge (Cloudflare Worker).
 */
export function verifyExactPayment(payment: X402Payment, requirements: X402Requirements, opts: { now?: number } = {}): VerifyResult {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const fail = (reason: string): VerifyResult => ({ isValid: false, payer: null, invalidReason: reason });

  if (!payment || payment.scheme !== SCHEME_EXACT) return fail('unsupported_scheme');
  if (String(payment.network) !== String(requirements.network)) return fail('network_mismatch');
  const p = payment.payload;
  if (!p || !p.authorization || !p.signature) return fail('malformed_payload');
  const a = p.authorization;

  let chainId: number;
  try {
    chainId = networkToChainId(requirements.network);
  } catch {
    return fail('unknown_network');
  }

  const extra = requirements.extra ?? {};
  const domain = { name: extra.name ?? '', version: String(extra.version ?? '2'), chainId, verifyingContract: requirements.asset };
  const message = { from: a.from, to: a.to, value: a.value, validAfter: a.validAfter, validBefore: a.validBefore, nonce: a.nonce };

  let signer: string;
  try {
    signer = verifyTypedData(domain, TRANSFER_TYPES, message, p.signature);
  } catch {
    return fail('bad_signature');
  }

  if (getAddress(signer) !== getAddress(a.from)) return fail('signer_mismatch');
  if (getAddress(a.to) !== getAddress(requirements.payTo)) return fail('wrong_recipient');
  if (BigInt(a.value) < BigInt(requirements.maxAmountRequired)) return fail('insufficient_amount');
  if (Number(a.validBefore) <= now) return fail('expired');
  if (Number(a.validAfter) > now) return fail('not_yet_valid');

  return { isValid: true, payer: getAddress(signer), invalidReason: null };
}
