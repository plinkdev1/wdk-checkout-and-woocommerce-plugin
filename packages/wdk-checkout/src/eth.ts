import type * as Ethers from 'ethers'
import type { EthereumProvider } from './types.js'

export type EthersLib = typeof Ethers

/** The WDK wallet extension's EIP-6963 rdns — preferred when present. */
export const WDK_WALLET_RDNS = 'app.wdkstarter.wallet'

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

/** Returns the legacy injected EIP-1193 provider (`window.ethereum`), or null. */
export function getInjectedProvider (): EthereumProvider | null {
  const eth = (globalThis as unknown as { ethereum?: EthereumProvider }).ethereum
  return eth ?? null
}

/** EIP-6963 provider metadata announced by a wallet. */
export interface Eip6963ProviderInfo {
  readonly uuid: string
  readonly name: string
  readonly icon: string
  readonly rdns: string
}

/** A discovered EIP-6963 wallet: its metadata + EIP-1193 provider. */
export interface Eip6963ProviderDetail {
  readonly info: Eip6963ProviderInfo
  readonly provider: EthereumProvider
}

/**
 * Discover installed wallets via EIP-6963 (multi-wallet discovery). Dispatches
 * `eip6963:requestProvider` and collects the `eip6963:announceProvider` events
 * wallets fire in response, de-duped by uuid. Lets a buyer pay from the WDK
 * wallet extension (or any announced wallet) instead of only `window.ethereum`.
 */
export function discoverWallets (timeoutMs = 250): Promise<Eip6963ProviderDetail[]> {
  const w = (globalThis as unknown as { window?: Window }).window
  if (!w || typeof w.addEventListener !== 'function') return Promise.resolve([])
  return new Promise<Eip6963ProviderDetail[]>((resolve) => {
    const found = new Map<string, Eip6963ProviderDetail>()
    const onAnnounce = (e: Event): void => {
      const detail = (e as CustomEvent<Eip6963ProviderDetail>).detail
      if (detail?.info?.uuid && detail.provider) found.set(detail.info.uuid, detail)
    }
    w.addEventListener('eip6963:announceProvider', onAnnounce as EventListener)
    w.dispatchEvent(new Event('eip6963:requestProvider'))
    setTimeout(() => {
      w.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener)
      resolve([...found.values()])
    }, timeoutMs)
  })
}

/**
 * Resolve the EIP-1193 provider to pay with. Prefers the WDK wallet (or
 * `opts.preferRdns`) among EIP-6963-announced wallets, then the first announced
 * wallet, then falls back to the legacy `window.ethereum`. Returns null if no
 * wallet is available.
 */
export async function resolveWalletProvider (
  opts?: { preferRdns?: string, timeoutMs?: number }
): Promise<EthereumProvider | null> {
  const prefer = opts?.preferRdns ?? WDK_WALLET_RDNS
  const wallets = await discoverWallets(opts?.timeoutMs)
  if (wallets.length > 0) {
    const preferred = wallets.find((wlt) => wlt.info.rdns === prefer)
    return (preferred ?? wallets[0]!).provider
  }
  return getInjectedProvider()
}

/** Converts a numeric chain id to the `0x`-prefixed hex form EIP-1193 expects. */
export function toHexChainId (chainId: number): string {
  return '0x' + chainId.toString(16)
}
