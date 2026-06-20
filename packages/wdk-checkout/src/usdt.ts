import type { PaymentIntent } from './types.js'
import { getEthers, getInjectedProvider, toHexChainId } from './eth.js'

/** Minimal ERC-20 ABI for transfers and balance checks. */
export const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
]

/** Connects the injected wallet and returns the selected account address. */
export async function connectWallet (): Promise<string> {
  const provider = getInjectedProvider()
  if (!provider) throw new Error('No EVM wallet found. Install a WDK-powered or compatible wallet extension.')
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  if (!accounts || accounts.length === 0) throw new Error('Wallet connection was rejected.')
  return accounts[0] as string
}

/**
 * Ensures the wallet is on the intent's chain, requesting a switch if needed.
 * Silently tolerates wallets that are already on the right chain.
 */
export async function ensureChain (chainId: number): Promise<void> {
  const provider = getInjectedProvider()
  if (!provider) throw new Error('No EVM wallet found.')
  const current = (await provider.request({ method: 'eth_chainId' })) as string
  if (current && parseInt(current, 16) === chainId) return
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHexChainId(chainId) }] })
  } catch (err) {
    throw new Error(`Please switch your wallet to ${chainId} to pay, then try again.`)
  }
}

/**
 * Sends the USDt transfer for a payment intent from the connected wallet and
 * returns the broadcast transaction hash. The customer pays gas (direct,
 * non-custodial transfer). For a gasless variant see the EIP-3009 path in the
 * project README (wdk-protocol-eip3009).
 */
export async function payIntent (intent: PaymentIntent): Promise<string> {
  const ethers = getEthers()
  const injected = getInjectedProvider()
  if (!injected) throw new Error('No EVM wallet found.')

  await connectWallet()
  await ensureChain(intent.chainId)

  const browserProvider = new ethers.BrowserProvider(injected as never)
  const signer = await browserProvider.getSigner()
  const token = new ethers.Contract(intent.tokenAddress, ERC20_ABI, signer)

  const value = BigInt(intent.amountBase)
  const tx = await token.transfer!(intent.receivingAddress, value)
  return tx.hash as string
}
