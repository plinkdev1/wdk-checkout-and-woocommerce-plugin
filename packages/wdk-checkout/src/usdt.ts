import type { EthereumProvider, PaymentIntent } from './types.js'
import { getEthers, resolveWalletProvider, toHexChainId } from './eth.js'
import { CheckoutError, toCheckoutError } from './errors.js'

/** Minimal ERC-20 ABI for transfers and balance checks. */
export const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
]

/**
 * Connects a wallet and returns the selected account address. Uses EIP-6963
 * discovery (preferring the WDK wallet extension) so buyers without MetaMask
 * can pay; falls back to the legacy `window.ethereum`. Pass an explicit
 * `provider` to reuse one already resolved by the caller.
 */
export async function connectWallet (provider?: EthereumProvider): Promise<string> {
  const p = provider ?? await resolveWalletProvider()
  if (!p) throw new CheckoutError('NO_WALLET', 'No EVM wallet found. Install the WDK wallet extension or a compatible wallet.')
  let accounts: string[]
  try {
    accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[]
  } catch (err) {
    throw toCheckoutError(err, 'WALLET_REJECTED')
  }
  if (!accounts || accounts.length === 0) throw new CheckoutError('WALLET_REJECTED', 'Wallet connection was rejected.')
  return accounts[0] as string
}

/**
 * Ensures the wallet is on the intent's chain, requesting a switch if needed.
 * Silently tolerates wallets that are already on the right chain.
 */
export async function ensureChain (chainId: number, provider?: EthereumProvider): Promise<void> {
  const p = provider ?? await resolveWalletProvider()
  if (!p) throw new CheckoutError('NO_WALLET', 'No EVM wallet found.')
  const current = (await p.request({ method: 'eth_chainId' })) as string
  if (current && parseInt(current, 16) === chainId) return
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHexChainId(chainId) }] })
  } catch (err) {
    throw new CheckoutError('WRONG_CHAIN', `Please switch your wallet to chain ${chainId} to pay, then try again.`, { cause: err })
  }
}

/** The result of a wallet payment: the broadcast hash + the chain it settled on. */
export interface PayResult {
  readonly hash: string
  /** The chain the transfer was sent on (the primary, or an accepted alternative). */
  readonly chainId: number
}

/**
 * Resolves which chain + token to pay with. Multi-chain (item #2): if the wallet
 * is already on the primary chain or any `acceptedChains` entry, pay there with
 * that chain's token (no forced switch). Otherwise switch to the primary chain.
 * `currentChainId` is the wallet's current `eth_chainId` (decimal).
 */
export function resolvePayChain (
  intent: PaymentIntent,
  currentChainId: number,
): { chainId: number, tokenAddress: string, switchRequired: boolean } {
  const accepted: Record<number, string> = { [intent.chainId]: intent.tokenAddress, ...(intent.acceptedChains ?? {}) }
  const token = accepted[currentChainId]
  if (token) return { chainId: currentChainId, tokenAddress: token, switchRequired: false }
  return { chainId: intent.chainId, tokenAddress: intent.tokenAddress, switchRequired: true }
}

/**
 * Sends the USDt transfer for a payment intent from the connected wallet and
 * returns the broadcast transaction hash + the chain it settled on. The customer
 * pays gas (direct, non-custodial transfer). For a gasless variant see the
 * EIP-3009 path in the project README (@wdk-starter/wdk-protocol-eip3009).
 *
 * Multi-chain: when the wallet is already on the primary or an accepted chain,
 * the payment happens there (no switch) using that chain's token; the returned
 * `chainId` tells the caller which chain to verify on.
 *
 * Resolves the wallet once via EIP-6963 (preferring the WDK wallet extension)
 * and reuses it for connect + chain-switch + send. Throws a {@link CheckoutError}
 * with a stable `code` (NO_WALLET / NOT_CONFIGURED / WALLET_REJECTED /
 * WRONG_CHAIN / INSUFFICIENT_FUNDS / TX_FAILED) so headless callers can branch.
 */
export async function payIntent (intent: PaymentIntent): Promise<PayResult> {
  const provider = await resolveWalletProvider()
  if (!provider) throw new CheckoutError('NO_WALLET', 'No EVM wallet found. Install the WDK wallet extension or a compatible wallet.')

  let ethers: ReturnType<typeof getEthers>
  try {
    ethers = getEthers()
  } catch (err) {
    throw new CheckoutError('NOT_CONFIGURED', 'ethers is required for wallet payments — install the optional `ethers` peer dependency.', { cause: err })
  }

  await connectWallet(provider)

  // Pick the chain: stay on the wallet's chain if the merchant accepts it, else switch.
  let current = intent.chainId
  try {
    const hex = (await provider.request({ method: 'eth_chainId' })) as string
    if (hex) current = parseInt(hex, 16)
  } catch { /* fall back to the primary chain */ }
  const target = resolvePayChain(intent, current)
  if (target.switchRequired) await ensureChain(target.chainId, provider)

  try {
    const browserProvider = new ethers.BrowserProvider(provider as never)
    const signer = await browserProvider.getSigner()
    const token = new ethers.Contract(target.tokenAddress, ERC20_ABI, signer)

    const value = BigInt(intent.amountBase)
    const tx = await token.transfer!(intent.receivingAddress, value)
    return { hash: tx.hash as string, chainId: target.chainId }
  } catch (err) {
    throw toCheckoutError(err, 'TX_FAILED')
  }
}
