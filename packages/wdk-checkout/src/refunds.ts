/**
 * Refunds & partial captures (Phase 4 item 7).
 *
 * In the self-custodial model the merchant holds the funds, so a refund is just
 * a plain USDt `transfer` back to the original payer — there's no custodian to
 * claw back from. This module produces the refund **descriptor** (to / amount /
 * token / chain) and the exact ERC-20 `transfer` calldata the merchant's wallet
 * or relayer broadcasts. Partial refunds are a smaller amount than the capture.
 *
 * The WooCommerce gateway records the refund and fires a `payment.refunded`
 * webhook so the merchant's settlement system can execute the on-chain send.
 */

/** `transfer(address,uint256)` selector. */
const TRANSFER_SELECTOR = 'a9059cbb'

export interface RefundDescriptor {
  /** ERC-20 token contract the refund is paid in (the settlement token). */
  readonly token: string
  /** Refund recipient — the address that paid the order. */
  readonly to: string
  /** Refund amount in token base units (decimal string). */
  readonly amountBase: string
  /** EVM chain id the refund settles on. */
  readonly chainId: number
  /** WooCommerce order key the refund belongs to. */
  readonly orderKey: string
  /** Whether this is a partial refund (less than the captured amount). */
  readonly partial: boolean
  readonly reason?: string
}

function assertAddress (addr: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error(`refund: invalid ${label} address`)
}

/**
 * Build a validated refund descriptor. `amountBase` must be > 0 and ≤
 * `capturedBase` (the original payment); `partial` is derived from that.
 */
export function buildRefund (args: {
  token: string
  payer: string
  amountBase: string | bigint
  capturedBase: string | bigint
  chainId: number
  orderKey: string
  reason?: string
}): RefundDescriptor {
  assertAddress(args.token, 'token')
  assertAddress(args.payer, 'payer')
  const amount = BigInt(args.amountBase)
  const captured = BigInt(args.capturedBase)
  if (amount <= 0n) throw new Error('refund: amount must be greater than zero')
  if (amount > captured) throw new Error('refund: amount exceeds the captured payment')
  if (!Number.isInteger(args.chainId) || args.chainId <= 0) throw new Error('refund: invalid chainId')
  return {
    token: args.token,
    to: args.payer,
    amountBase: amount.toString(),
    chainId: args.chainId,
    orderKey: args.orderKey,
    partial: amount < captured,
    ...(args.reason !== undefined ? { reason: args.reason } : {}),
  }
}

/**
 * ABI-encodes the `transfer(payer, amount)` calldata the merchant broadcasts to
 * the token contract to settle a refund.
 */
export function refundTransferCalldata (to: string, amountBase: string | bigint): string {
  assertAddress(to, 'recipient')
  const amount = BigInt(amountBase)
  if (amount < 0n) throw new Error('refund: amount must be non-negative')
  const addr = to.toLowerCase().slice(2).padStart(64, '0')
  const amt = amount.toString(16).padStart(64, '0')
  return `0x${TRANSFER_SELECTOR}${addr}${amt}`
}
