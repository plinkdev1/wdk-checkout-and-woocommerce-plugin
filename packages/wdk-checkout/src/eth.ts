import type * as Ethers from 'ethers'
import type { EthereumProvider } from './types.js'

export type EthersLib = typeof Ethers

/**
 * Returns the global `ethers` UMD library, which the host page must load before
 * the widget. We use the global (rather than bundling ethers) so the checkout
 * bundle stays small and a single ethers instance is shared with the page.
 */
export function getEthers (): EthersLib {
  const e = (globalThis as unknown as { ethers?: EthersLib }).ethers
  if (!e) {
    throw new Error('The ethers UMD library must be loaded before the WDK checkout widget.')
  }
  return e
}

/** Returns the injected EIP-1193 provider (`window.ethereum`), or null. */
export function getInjectedProvider (): EthereumProvider | null {
  const eth = (globalThis as unknown as { ethereum?: EthereumProvider }).ethereum
  return eth ?? null
}

/** Converts a numeric chain id to the `0x`-prefixed hex form EIP-1193 expects. */
export function toHexChainId (chainId: number): string {
  return '0x' + chainId.toString(16)
}
