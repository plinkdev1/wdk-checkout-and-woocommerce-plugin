/**
 * Bitcoin unit helpers shared by the Lightning and on-chain BTC rails.
 *
 * Pure, dependency-free, and exact at integer-satoshi precision. Both
 * `wdk-checkout/lightning` and `wdk-checkout/bitcoin` re-export these so a
 * consumer of either rail has one consistent source of truth for sats math.
 */

/** Satoshis in one whole bitcoin. */
export const SATS_PER_BTC = 100_000_000

/** Convert BTC to integer satoshis (rounded). */
export function btcToSats (btc: number): number {
  if (!isFinite(btc) || btc < 0) throw new Error('sats: btc must be a non-negative finite number')
  return Math.round(btc * SATS_PER_BTC)
}

/** Convert integer satoshis to a BTC decimal string (8 dp, trailing zeros trimmed). */
export function satsToBtcString (sats: number): string {
  if (!isFinite(sats) || sats < 0) throw new Error('sats: sats must be a non-negative finite number')
  const whole = Math.floor(Math.round(sats) / SATS_PER_BTC)
  const frac = Math.round(sats) % SATS_PER_BTC
  if (frac === 0) return String(whole)
  const fracStr = String(frac).padStart(8, '0').replace(/0+$/, '')
  return `${whole}.${fracStr}`
}

/** Satoshis needed for a fiat amount, given the BTC price in that fiat. */
export function satsForFiat (args: { fiatAmount: number, btcPriceFiat: number }): number {
  const { fiatAmount, btcPriceFiat } = args
  if (!isFinite(fiatAmount) || fiatAmount < 0) throw new Error('sats: fiatAmount must be a non-negative finite number')
  if (!isFinite(btcPriceFiat) || btcPriceFiat <= 0) throw new Error('sats: btcPriceFiat must be a positive finite number')
  return Math.round((fiatAmount / btcPriceFiat) * SATS_PER_BTC)
}

/** Human display for a sats amount, e.g. "1,234 sats". */
export function formatSats (sats: number): string {
  return `${Math.round(sats).toLocaleString('en-US')} sats`
}
