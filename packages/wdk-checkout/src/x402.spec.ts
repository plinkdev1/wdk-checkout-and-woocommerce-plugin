/**
 * Unit tests for the x402 facilitator: building the 402 challenge and verifying
 * a signed EIP-3009 ("exact"-scheme) payment, including the rejection paths an
 * edge Worker relies on. Signatures are produced with a real ethers Wallet so
 * the recovery path is exercised end-to-end.
 */
import { describe, it, expect } from 'vitest';
import { Wallet } from 'ethers';
import { buildPaymentRequirements, buildPaymentRequiredResponse, verifyExactPayment, networkToChainId, type X402Requirements } from './x402.js';

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Hardhat #0 (public)
const PAY_TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const ASSET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC mainnet

const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  ],
};

function reqs(over: Partial<Parameters<typeof buildPaymentRequirements>[0]> = {}): X402Requirements {
  return buildPaymentRequirements({ network: 'ethereum', asset: ASSET, payTo: PAY_TO, maxAmountRequired: '10000', name: 'USD Coin', version: '2', maxTimeoutSeconds: 120, ...over });
}

async function pay(r: X402Requirements, wallet: Wallet, now = Math.floor(Date.now() / 1000)) {
  const chainId = networkToChainId(r.network);
  const domain = { name: r.extra!.name, version: r.extra!.version, chainId, verifyingContract: r.asset };
  const authorization = { from: wallet.address, to: r.payTo, value: r.maxAmountRequired, validAfter: '0', validBefore: String(now + (r.maxTimeoutSeconds ?? 60)), nonce: '0x' + '22'.repeat(32) };
  const signature = await wallet.signTypedData(domain, TYPES, authorization);
  return { x402Version: 1, scheme: 'exact', network: r.network, payload: { signature, authorization } };
}

describe('x402 facilitator', () => {
  it('builds a 402 challenge body', () => {
    const body = buildPaymentRequiredResponse(reqs());
    expect(body.x402Version).toBe(1);
    expect(body.accepts[0]!.scheme).toBe('exact');
    expect(body.accepts[0]!.payTo).toBe(PAY_TO);
  });

  it('verifies a valid signed payment and recovers the payer', async () => {
    const wallet = new Wallet(KEY);
    const r = reqs();
    const result = verifyExactPayment(await pay(r, wallet), r);
    expect(result.isValid).toBe(true);
    expect(result.payer).toBe(wallet.address);
  });

  it('rejects wrong recipient, insufficient amount, network, tamper, and expiry', async () => {
    const wallet = new Wallet(KEY);
    const r = reqs();
    const payment = await pay(r, wallet);

    expect(verifyExactPayment(payment, reqs({ payTo: '0x000000000000000000000000000000000000dEaD' })).invalidReason).toBe('wrong_recipient');
    expect(verifyExactPayment(payment, reqs({ maxAmountRequired: '20000' })).invalidReason).toBe('insufficient_amount');
    expect(verifyExactPayment(payment, reqs({ network: 'base' })).invalidReason).toBe('network_mismatch');

    const tampered = { ...payment, payload: { ...payment.payload, authorization: { ...payment.payload.authorization, value: '1' } } };
    expect(verifyExactPayment(tampered, r).invalidReason).toBe('signer_mismatch');

    const expired = await pay(r, wallet, 1_000_000_000);
    expect(verifyExactPayment(expired, r).invalidReason).toBe('expired');
  });
});
