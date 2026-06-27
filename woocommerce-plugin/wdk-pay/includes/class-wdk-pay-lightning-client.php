<?php
/**
 * Lightning backend client.
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay_Lightning_Client
 *
 * Mints and polls BOLT11 invoices over a merchant-configured Lightning REST
 * backend — a Spark service, LNbits, LND-REST, or any endpoint that speaks the
 * same shape. This is the PHP mirror of the JS `@wdk-starter/wdk-checkout/lightning`
 * `createLightningClient` (tolerant field parsing, normalized status), so a store
 * accepts Lightning entirely server-side: no node URL or key ever reaches the
 * browser, and nothing here custodies funds.
 *
 * @package WDK_Pay
 */
class WDK_Pay_Lightning_Client {

	const SATS_PER_BTC = 100000000;

	const STATUS_PENDING = 'pending';
	const STATUS_PAID    = 'paid';
	const STATUS_EXPIRED = 'expired';

	/**
	 * Backend base URL (no trailing slash).
	 *
	 * @var string
	 */
	private $base_url;

	/**
	 * Optional API key sent as a header.
	 *
	 * @var string
	 */
	private $api_key;

	/**
	 * Header name for the API key (default `X-Api-Key`).
	 *
	 * @var string
	 */
	private $auth_header;

	/**
	 * Path for creating invoices (POST).
	 *
	 * @var string
	 */
	private $create_path;

	/**
	 * Template for reading an invoice (GET); `{id}` is substituted.
	 *
	 * @var string
	 */
	private $status_path_tpl;

	/**
	 * Constructor.
	 *
	 * @param array<string,string> $cfg Backend config (base_url, api_key, auth_header, create_path, status_path).
	 */
	public function __construct( array $cfg ) {
		$this->base_url        = untrailingslashit( (string) ( isset( $cfg['base_url'] ) ? $cfg['base_url'] : '' ) );
		$this->api_key         = (string) ( isset( $cfg['api_key'] ) ? $cfg['api_key'] : '' );
		$this->auth_header     = (string) ( isset( $cfg['auth_header'] ) && '' !== $cfg['auth_header'] ? $cfg['auth_header'] : 'X-Api-Key' );
		$this->create_path     = (string) ( isset( $cfg['create_path'] ) && '' !== $cfg['create_path'] ? $cfg['create_path'] : '/invoices' );
		$this->status_path_tpl = (string) ( isset( $cfg['status_path'] ) && '' !== $cfg['status_path'] ? $cfg['status_path'] : '/invoices/{id}' );
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
	 * Map a backend's status field to pending/paid/expired.
	 *
	 * @param mixed $raw Backend status value.
	 * @return string One of the STATUS_* constants.
	 */
	public static function normalize_status( $raw ) {
		if ( true === $raw ) {
			return self::STATUS_PAID;
		}
		$s = strtolower( trim( (string) $raw ) );
		if ( in_array( $s, array( 'paid', 'settled', 'complete', 'completed', 'confirmed', 'success', 'succeeded' ), true ) ) {
			return self::STATUS_PAID;
		}
		if ( in_array( $s, array( 'expired', 'canceled', 'cancelled', 'failed' ), true ) ) {
			return self::STATUS_EXPIRED;
		}
		return self::STATUS_PENDING;
	}

	/**
	 * Create a BOLT11 invoice on the backend.
	 *
	 * @param int    $amount_sats    Amount in satoshis.
	 * @param string $memo           Optional memo.
	 * @param int    $expiry_seconds Invoice lifetime.
	 * @return array{id:string,bolt11:string,amount_sats:int,expires_at:int}|WP_Error
	 */
	public function create_invoice( $amount_sats, $memo = '', $expiry_seconds = 3600 ) {
		$res = wp_remote_post(
			$this->base_url . $this->create_path,
			array(
				'headers' => $this->headers( true ),
				'timeout' => 20,
				'body'    => wp_json_encode(
					array(
						'amount_sats' => (int) $amount_sats,
						'memo'        => (string) $memo,
						'expiry'      => (int) $expiry_seconds,
					)
				),
			)
		);

		$json = $this->decode( $res );
		if ( is_wp_error( $json ) ) {
			return $json;
		}

		$id     = self::pick( $json, 'id', 'payment_hash', 'paymentHash', 'checking_id', 'r_hash' );
		$bolt11 = self::pick( $json, 'bolt11', 'payment_request', 'paymentRequest', 'request', 'invoice' );

		if ( ! is_string( $id ) || ! is_string( $bolt11 ) || '' === $id || '' === $bolt11 ) {
			return new WP_Error( 'wdk_ln_parse', __( 'Lightning backend response had no id/bolt11.', 'wdk-pay' ) );
		}

		$expires = self::pick( $json, 'expires_at', 'expiresAt', 'expiry' );

		return array(
			'id'          => $id,
			'bolt11'      => $bolt11,
			'amount_sats' => (int) $amount_sats,
			'expires_at'  => is_numeric( $expires ) ? (int) $expires : ( time() + (int) $expiry_seconds ),
		);
	}

	/**
	 * Read an invoice's normalized status from the backend.
	 *
	 * @param string $invoice_id Provider invoice id / payment hash.
	 * @return string|WP_Error One of the STATUS_* constants, or WP_Error on transport failure.
	 */
	public function get_invoice_status( $invoice_id ) {
		$path = str_replace( '{id}', rawurlencode( (string) $invoice_id ), $this->status_path_tpl );
		$res  = wp_remote_get(
			$this->base_url . $path,
			array(
				'headers' => $this->headers( false ),
				'timeout' => 20,
			)
		);

		$json = $this->decode( $res );
		if ( is_wp_error( $json ) ) {
			return $json;
		}

		$raw = self::pick( $json, 'status', 'state', 'paid', 'settled' );
		return self::normalize_status( $raw );
	}

	/**
	 * Build request headers (adds the API key header when configured).
	 *
	 * @param bool $json Whether to set a JSON content type.
	 * @return array<string,string>
	 */
	private function headers( $json ) {
		$h = array();
		if ( $json ) {
			$h['Content-Type'] = 'application/json';
		}
		if ( '' !== $this->api_key ) {
			$h[ $this->auth_header ] = $this->api_key;
		}
		return $h;
	}

	/**
	 * Validate an HTTP response and decode its JSON body.
	 *
	 * @param array|WP_Error $res wp_remote_* result.
	 * @return array<string,mixed>|WP_Error
	 */
	private function decode( $res ) {
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$code = (int) wp_remote_retrieve_response_code( $res );
		if ( $code < 200 || $code >= 300 ) {
			/* translators: %d: HTTP status code. */
			return new WP_Error( 'wdk_ln_http', sprintf( __( 'Lightning backend HTTP %d.', 'wdk-pay' ), $code ) );
		}
		$json = json_decode( (string) wp_remote_retrieve_body( $res ), true );
		if ( ! is_array( $json ) ) {
			return new WP_Error( 'wdk_ln_parse', __( 'Lightning backend returned a non-JSON response.', 'wdk-pay' ) );
		}
		return $json;
	}

	/**
	 * Return the first present, non-null value among the given keys.
	 *
	 * @param array<string,mixed> $o    Source map.
	 * @param string              ...$keys Candidate keys.
	 * @return mixed|null
	 */
	private static function pick( array $o, ...$keys ) {
		foreach ( $keys as $k ) {
			if ( isset( $o[ $k ] ) && null !== $o[ $k ] ) {
				return $o[ $k ];
			}
		}
		return null;
	}
}
