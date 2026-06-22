import type { PaymentIntent } from './types.js'
import { getEthers, getInjectedProvider, toHexChainId } from './eth.js'
import { CheckoutError, toCheckoutError } from './errors.js'

/** Minimal ERC-20 ABI for transfers and balance checks. */
export const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
]

/** Connects the injected wallet and returns the selected account address. */
export async function connectWallet (): Promise<string> {
  const provider = getInjectedProvider()
  if (!provider) throw new CheckoutError('NO_WALLET', 'No EVM wallet found. Install a WDK-powered or compatible wallet extension.')
  let accounts: string[]
  try {
    accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
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
export async function ensureChain (chainId: number): Promise<void> {
  const provider = getInjectedProvider()
  if (!provider) throw new CheckoutError('NO_WALLET', 'No EVM wallet found.')
  const current = (await provider.request({ method: 'eth_chainId' })) as string
  if (current && parseInt(current, 16) === chainId) return
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHexChainId(chainId) }] })
  } catch (err) {
    throw new CheckoutError('WRONG_CHAIN', `Please switch your wallet to chain ${chainId} to pay, then try again.`, { cause: err })
  }
}

/**
 * Sends the USDt transfer for a payment intent from the connected wallet and
 * returns the broadcast transaction hash. The customer pays gas (direct,
 * non-custodial transfer). For a gasless variant see the EIP-3009 path in the
 * project README (@wdk-starter/wdk-protocol-eip3009).
 *
 * Throws a {@link CheckoutError} with a stable `code` (NO_WALLET / NOT_CONFIGURED
 * / WALLET_REJECTED / WRONG_CHAIN / INSUFFICIENT_FUNDS / TX_FAILED) so headless
 * callers can branch on the failure reason.
 */
export async function payIntent (intent: PaymentIntent): Promise<string> {
  const injected = getInjectedProvider()
  if (!injected) throw new CheckoutError('NO_WALLET', 'No EVM wallet found.')

  let ethers: ReturnType<typeof getEthers>
  try {
    ethers = getEthers()
  } catch (err) {
    throw new CheckoutError('NOT_CONFIGURED', 'ethers is required for wallet payments — install the optional `ethers` peer dependency.', { cause: err })
  }

  // connectWallet / ensureChain already throw typed CheckoutErrors.
  await connectWallet()
  await ensureChain(intent.chainId)

  try {
    const browserProvider = new ethers.BrowserProvider(injected as never)
    const signer = await browserProvider.getSigner()
    const token = new ethers.Contract(intent.tokenAddress, ERC20_ABI, signer)

    const value = BigInt(intent.amountBase)
    const tx = await token.transfer!(intent.receivingAddress, value)
    return tx.hash as string
  } catch (err) {
    throw toCheckoutError(err, 'TX_FAILED')
  }
}
