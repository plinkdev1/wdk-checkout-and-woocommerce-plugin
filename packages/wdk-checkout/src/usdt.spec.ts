/**
 * Multi-chain pay resolution (Phase 2 item 2) — pure chain/token selection.
 * (payIntent itself drives a wallet and isn't unit-tested here.)
 */
import { describe, it, expect } from 'vitest'
import { resolvePayChain } from './usdt.js'
import type { PaymentIntent } from './types.js'

const base: PaymentIntent = {
  orderId: 1, orderKey: 'k', amount: '19.99', amountBase: '19990000', decimals: 6,
  tokenAddress: '0xETH_USDt', tokenSymbol: 'USDt', chainId: 1, chainName: 'Ethereum', chainKey: 'ethereum',
  receivingAddress: '0xrcv', reference: '0x0', status: 'pending', expiresAt: 0,
  acceptedChains: { 137: '0xPOLY_USDt', 42161: '0xARB_USDt' },
}

describe('resolvePayChain', () => {
  it('stays on the primary chain when the wallet is already there', () => {
    expect(resolvePayChain(base, 1)).toEqual({ chainId: 1, tokenAddress: '0xETH_USDt', switchRequired: false })
  })

  it('pays on an accepted alternative chain (no switch) with that chain’s token', () => {
    expect(resolvePayChain(base, 137)).toEqual({ chainId: 137, tokenAddress: '0xPOLY_USDt', switchRequired: false })
    expect(resolvePayChain(base, 42161)).toEqual({ chainId: 42161, tokenAddress: '0xARB_USDt', switchRequired: false })
  })

  it('switches to the primary chain when the wallet is on an unaccepted chain', () => {
    expect(resolvePayChain(base, 56)).toEqual({ chainId: 1, tokenAddress: '0xETH_USDt', switchRequired: true })
  })

  it('with no acceptedChains, only the primary chain avoids a switch', () => {
    const single = { ...base, acceptedChains: undefined }
    expect(resolvePayChain(single, 1).switchRequired).toBe(false)
    expect(resolvePayChain(single, 137).switchRequired).toBe(true)
  })
})
