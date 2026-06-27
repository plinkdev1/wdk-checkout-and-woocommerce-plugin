<?php
/**
 * On-chain Bitcoin address watcher (Esplora/mempool.space REST).
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay_Bitcoin_Watcher
 *
 * Watches a Bitcoin address for an incoming payment using a merchant-configured
 * Esplora-compatible REST API (mempool.space, Blockstream, or a self-hosted
 * Esplora). This is the PHP mirror of the JS `@wdk-starter/wdk-checkout/bitcoin`
 * rail (`createEsploraWatcher` + `evaluateAddressTxs`): tolerant parsing, a pure
 * evaluation step, and a normalized pending/paid status — so a store accepts
 * native BTC entirely server-side. Nothing here custodies funds; the merchant
 * receives directly into their own (ideally per-order, BIP-84) address.
 *
 * @package WDK_Pay
 */
class WDK_Pay_Bitcoin_Watcher {

	const SATS_PER_BTC = 100000000;

	const STATUS_PENDING = 'pending';
	const STATUS_PAID    = 'paid';
	const STATUS_EXPIRED = 'expired';

	/**
	 * Esplora base URL (no trailing slash), e.g. https://mempool.space/api.
	 *
	 * @var string
	 */
	private $base_url;

	/**
	 * Optional extra request headers (e.g. an API key).
	 *
	 * @var array<string,string>
	 */
	private $headers;

	/**
	 * Constructor.
	 *
	 * @param array{base_url:string,headers?:array<string,string>} $cfg Watcher config.
	 */
	public function __construct( array $cfg ) {
		$this->base_url = untrailingslashit( (string) ( isset( $cfg['base_url'] ) ? $cfg['base_url'] : '' ) );
		$this->headers  = isset( $cfg['headers'] ) && is_array( $cfg['headers'] ) ? $cfg['headers'] : array();
	}

	/**
	 * Satoshis needed for a fiat amount, given the BTC price in that fiat.
	 *
	 * @param float|string $fiat_amount    Order total in store currency.
	 * @param float|string $btc_price_fiat Price of 1 BTC in the store currency.
	 * @return int Integer satoshis (0 when the price is non-positive).
	 */
	public static function sats_for_fiat( $fiat_amount, $btc_price_fiat ) {
		$fiat  = (float) $fiat_amount;
		$price = (float) $btc_price_fiat;
		if ( $price <= 0 || $fiat < 0 ) {
			return 0;
		}
		return (int) round( ( $fiat / $price ) * self::SATS_PER_BTC );
	}

	/**
	 * Human display for a sats amount, e.g. "1,234 sats".
	 *
	 * @param int $sats Satoshis.
	 * @return string
	 */
	public static function format_sats( $sats ) {
		return number_format_i18n( (int) $sats ) . ' sats';
	}

	/**
	 * Render integer sats as a BTC decimal string (8 dp, trailing zeros trimmed).
	 *
	 * @param int $sats Satoshis.
	 * @return string BTC amount string (e.g. "0.0005").
	 */
	public static function sats_to_btc_string( $sats ) {
		$sats = max( 0, (int) $sats );
		$whole = intdiv( $sats, self::SATS_PER_BTC );
		$frac  = $sats % self::SATS_PER_BTC;
		if ( 0 === $frac ) {
			return (string) $whole;
		}
		$frac_str = rtrim( str_pad( (string) $frac, 8, '0', STR_PAD_LEFT ), '0' );
		return $whole . '.' . $frac_str;
	}

	/**
	 * Build a BIP-21 payment URI (`bitcoin:<addr>?amount=…&label=…`).
	 *
	 * @param string $address  Receiving address.
	 * @param int    $sats     Amount in satoshis (0 omits the amount).
	 * @param string $label    Optional label.
	 * @return string BIP-21 URI.
	 */
	public static function build_bip21_uri( $address, $sats, $label = '' ) {
		$address = trim( (string) $address );
		if ( '' === $address ) {
			return '';
		}
		$params = array();
		if ( (int) $sats > 0 ) {
			$params[] = 'amount=' . self::sats_to_btc_string( (int) $sats );
		}
		if ( '' !== $label ) {
			$params[] = 'label=' . rawurlencode( substr( (string) $label, 0, 128 ) );
		}
		return 'bitcoin:' . $address . ( ! empty( $params ) ? '?' . implode( '&', $params ) : '' );
	}

	/**
	 * Read an address's normalized payment status from the Esplora backend.
	 *
	 * @param string $address            Receiving address.
	 * @param int    $min_amount_sats    Minimum required amount in sats.
	 * @param int    $required_confirms  Confirmations required for "paid".
	 * @return array{status:string,received_sats:int,confirmations:int,txid:string}|WP_Error
	 */
	public function get_address_status( $address, $min_amount_sats, $required_confirms ) {
		$address = trim( (string) $address );
		if ( '' === $address ) {
			return new WP_Error( 'wdk_btc_addr', __( 'No Bitcoin address to watch.', 'wdk-pay' ) );
		}
		if ( '' === $this->base_url ) {
			return new WP_Error( 'wdk_btc_cfg', __( 'No Bitcoin watch endpoint configured.', 'wdk-pay' ) );
		}

		$txs = $this->get_json( '/address/' . rawurlencode( $address ) . '/txs' );
		if ( is_wp_error( $txs ) ) {
			return $txs;
		}
		$tip = $this->get_json( '/blocks/tip/height' );
		if ( is_wp_error( $tip ) ) {
			return $tip;
		}

		$tip_height = is_numeric( $tip ) ? (int) $tip : 0;

		return self::evaluate_address_txs(
			is_array( $txs ) ? $txs : array(),
			$address,
			(int) $min_amount_sats,
			(int) $required_confirms,
			$tip_height
		);
	}

	/**
	 * Sum the outputs of a tx that pay a given address (in sats).
	 *
	 * @param array<string,mixed> $tx      Esplora tx object.
	 * @param string              $address Target address.
	 * @return int Total sats paid to the address by this tx.
	 */
	public static function sum_outputs_to_address( array $tx, $address ) {
		$outs  = isset( $tx['vout'] ) && is_array( $tx['vout'] ) ? $tx['vout'] : array();
		$total = 0;
		foreach ( $outs as $o ) {
			if ( is_array( $o ) && isset( $o['scriptpubkey_address'] ) && $o['scriptpubkey_address'] === $address ) {
				$total += (int) ( isset( $o['value'] ) ? $o['value'] : 0 );
			}
		}
		return $total;
	}

	/**
	 * Decide an address's payment status from its tx list + the chain tip. Pure
	 * (no I/O): picks the most-confirmed tx paying >= the required amount and
	 * computes its confirmations against the tip.
	 *
	 * @param array<int,array<string,mixed>> $txs               Esplora tx list.
	 * @param string                         $address           Target address.
	 * @param int                            $min_amount_sats   Minimum amount in sats.
	 * @param int                            $required_confirms Confirmations for "paid".
	 * @param int                            $tip_height        Current chain tip height.
	 * @return array{status:string,received_sats:int,confirmations:int,txid:string}
	 */
	public static function evaluate_address_txs( array $txs, $address, $min_amount_sats, $required_confirms, $tip_height ) {
		$required = max( 1, (int) $required_confirms );
		$best     = null;

		foreach ( $txs as $tx ) {
			if ( ! is_array( $tx ) ) {
				continue;
			}
			$received = self::sum_outputs_to_address( $tx, $address );
			if ( $received < (int) $min_amount_sats ) {
				continue;
			}
			$status        = isset( $tx['status'] ) && is_array( $tx['status'] ) ? $tx['status'] : array();
			$confirmed     = isset( $status['confirmed'] ) && true === $status['confirmed'];
			$block_height  = isset( $status['block_height'] ) ? (int) $status['block_height'] : 0;
			$confirmations = ( $confirmed && $block_height > 0 ) ? max( 0, (int) $tip_height - $block_height + 1 ) : 0;
			$txid          = isset( $tx['txid'] ) ? (string) $tx['txid'] : '';

			if ( null === $best || $confirmations > $best['confirmations'] ) {
				$best = array(
					'received'      => $received,
					'confirmations' => $confirmations,
					'txid'          => $txid,
				);
			}
		}

		if ( null === $best ) {
			return array(
				'status'        => self::STATUS_PENDING,
				'received_sats' => 0,
				'confirmations' => 0,
				'txid'          => '',
			);
		}

		return array(
			'status'        => $best['confirmations'] >= $required ? self::STATUS_PAID : self::STATUS_PENDING,
			'received_sats' => (int) $best['received'],
			'confirmations' => (int) $best['confirmations'],
			'txid'          => (string) $best['txid'],
		);
	}

	/**
	 * GET a JSON document from the Esplora backend.
	 *
	 * @param string $path Path beginning with '/'.
	 * @return mixed|WP_Error Decoded JSON (array or scalar), or WP_Error on failure.
	 */
	private function get_json( $path ) {
		$res = wp_remote_get(
			$this->base_url . $path,
			array(
				'headers' => $this->headers,
				'timeout' => 20,
			)
		);

		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$code = (int) wp_remote_retrieve_response_code( $res );
		if ( $code < 200 || $code >= 300 ) {
			/* translators: %d: HTTP status code. */
			return new WP_Error( 'wdk_btc_http', sprintf( __( 'Bitcoin watch endpoint HTTP %d.', 'wdk-pay' ), $code ) );
		}
		$body = (string) wp_remote_retrieve_body( $res );
		$json = json_decode( $body, true );
		if ( null === $json && 'null' !== trim( $body ) ) {
			// Esplora returns a bare integer for /blocks/tip/height — accept numeric bodies.
			if ( is_numeric( trim( $body ) ) ) {
				return trim( $body );
			}
			return new WP_Error( 'wdk_btc_parse', __( 'Bitcoin watch endpoint returned a non-JSON response.', 'wdk-pay' ) );
		}
		return $json;
	}
}
