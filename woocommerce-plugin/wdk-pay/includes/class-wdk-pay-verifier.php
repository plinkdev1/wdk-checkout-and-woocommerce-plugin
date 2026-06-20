<?php
/**
 * On-chain payment verifier.
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay_Verifier
 *
 * Verifies an ERC-20 (USDt) transfer on-chain using JSON-RPC over HTTP. The
 * verifier is deliberately self-contained and dependency-free: it speaks raw
 * JSON-RPC via wp_remote_post and decodes receipts/logs by hand so it works
 * against any standard EVM node or hosted RPC provider.
 *
 * Verification steps:
 *   1. eth_getTransactionReceipt(txHash) must exist and have status == 0x1.
 *   2. Among the receipt logs, locate an ERC-20 Transfer event whose emitter is
 *      the configured USDt token, whose indexed `to` equals the merchant
 *      receiving address, and whose value is >= the required base amount.
 *   3. Confirmations (head - receipt.blockNumber + 1) must meet the threshold.
 *
 * @package WDK_Pay
 */
class WDK_Pay_Verifier {

	/**
	 * Result: payment confirmed (valid transfer with enough confirmations).
	 *
	 * @var string
	 */
	const CONFIRMED = 'confirmed';

	/**
	 * Result: payment seen but not yet final (no receipt yet, or too few confs).
	 *
	 * @var string
	 */
	const PENDING = 'pending';

	/**
	 * Result: payment invalid (reverted, wrong token/recipient/amount, RPC error).
	 *
	 * @var string
	 */
	const FAILED = 'failed';

	/**
	 * keccak256("Transfer(address,address,uint256)") — the ERC-20 Transfer topic.
	 *
	 * @var string
	 */
	const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

	/**
	 * JSON-RPC endpoint URL.
	 *
	 * @var string
	 */
	private $rpc_url;

	/**
	 * HTTP request timeout in seconds.
	 *
	 * @var int
	 */
	private $timeout;

	/**
	 * Constructor.
	 *
	 * @param string $rpc_url JSON-RPC endpoint URL.
	 * @param int    $timeout Optional request timeout in seconds (default 20).
	 */
	public function __construct( $rpc_url, $timeout = 20 ) {
		$this->rpc_url = (string) $rpc_url;
		$this->timeout = max( 1, (int) $timeout );
	}

	/**
	 * Verify a USDt transfer for an order.
	 *
	 * @param string $tx_hash          Transaction hash (0x + 64 hex).
	 * @param string $token_address    Expected USDt token contract address.
	 * @param string $to_address       Expected recipient (merchant) address.
	 * @param string $min_amount_base  Minimum required amount in base units (decimal string).
	 * @param int    $required_confirms Required confirmation count.
	 * @return array{status:string,message:string,confirmations?:int,valueBase?:string} Verification result.
	 */
	public function verify( $tx_hash, $token_address, $to_address, $min_amount_base, $required_confirms ) {
		if ( ! self::is_tx_hash( $tx_hash ) ) {
			return $this->result( self::FAILED, __( 'Malformed transaction hash.', 'wdk-pay' ) );
		}

		if ( '' === $this->rpc_url ) {
			return $this->result( self::FAILED, __( 'No RPC endpoint configured for verification.', 'wdk-pay' ) );
		}

		$required_confirms = max( 1, (int) $required_confirms );

		// Step 1: fetch the receipt.
		try {
			$receipt = $this->rpc( 'eth_getTransactionReceipt', array( $tx_hash ) );
		} catch ( Exception $e ) {
			// Treat transport/RPC errors as transient so the widget can re-poll.
			return $this->result( self::PENDING, __( 'Unable to reach RPC node; will retry.', 'wdk-pay' ) );
		}

		// A null receipt means the tx is unmined (or unknown) — keep polling.
		if ( null === $receipt || ! is_array( $receipt ) ) {
			return $this->result( self::PENDING, __( 'Transaction not yet mined.', 'wdk-pay' ) );
		}

		// Step 1b: the transaction must not have reverted.
		$status = isset( $receipt['status'] ) ? strtolower( (string) $receipt['status'] ) : '';
		if ( '0x1' !== $status ) {
			return $this->result( self::FAILED, __( 'Transaction reverted on-chain.', 'wdk-pay' ) );
		}

		// Step 2: find a matching ERC-20 Transfer log.
		$logs = isset( $receipt['logs'] ) && is_array( $receipt['logs'] ) ? $receipt['logs'] : array();
		$transfer = $this->find_matching_transfer( $logs, $token_address, $to_address, $min_amount_base );

		if ( null === $transfer ) {
			return $this->result(
				self::FAILED,
				__( 'No matching USDt transfer to the receiving address for the required amount.', 'wdk-pay' )
			);
		}

		// Step 3: confirmations.
		if ( ! isset( $receipt['blockNumber'] ) ) {
			return $this->result( self::PENDING, __( 'Receipt has no block number yet.', 'wdk-pay' ) );
		}

		$receipt_block = self::hex_to_int( (string) $receipt['blockNumber'] );

		try {
			$head_hex = $this->rpc( 'eth_blockNumber', array() );
		} catch ( Exception $e ) {
			return $this->result( self::PENDING, __( 'Unable to read chain head; will retry.', 'wdk-pay' ) );
		}

		$head_block    = self::hex_to_int( (string) $head_hex );
		$confirmations = ( $head_block - $receipt_block ) + 1;

		if ( $confirmations < $required_confirms ) {
			$result                  = $this->result( self::PENDING, __( 'Awaiting additional confirmations.', 'wdk-pay' ) );
			$result['confirmations'] = (int) max( 0, $confirmations );
			$result['valueBase']     = $transfer['value'];

			return $result;
		}

		$result                  = $this->result( self::CONFIRMED, __( 'Payment confirmed on-chain.', 'wdk-pay' ) );
		$result['confirmations'] = (int) $confirmations;
		$result['valueBase']     = $transfer['value'];

		return $result;
	}

	/**
	 * Locate a Transfer log matching token, recipient, and minimum amount.
	 *
	 * @param array<int,array<string,mixed>> $logs            Receipt logs.
	 * @param string                         $token_address   Expected token contract.
	 * @param string                         $to_address      Expected recipient.
	 * @param string                         $min_amount_base Minimum value in base units (decimal string).
	 * @return array{value:string}|null Matched log summary, or null if none match.
	 */
	private function find_matching_transfer( array $logs, $token_address, $to_address, $min_amount_base ) {
		$token_norm = self::normalize_address( $token_address );
		$to_norm    = self::normalize_address( $to_address );

		foreach ( $logs as $log ) {
			if ( ! is_array( $log ) ) {
				continue;
			}

			$topics = isset( $log['topics'] ) && is_array( $log['topics'] ) ? $log['topics'] : array();

			// Must be a Transfer event with the standard 3 topics (sig, from, to).
			if ( count( $topics ) < 3 ) {
				continue;
			}

			if ( strtolower( (string) $topics[0] ) !== self::TRANSFER_TOPIC ) {
				continue;
			}

			// Emitter (the log `address`) must be the USDt contract.
			$emitter = self::normalize_address( isset( $log['address'] ) ? (string) $log['address'] : '' );
			if ( '' === $token_norm || $emitter !== $token_norm ) {
				continue;
			}

			// Indexed `to` is topics[2], left-padded to 32 bytes; take last 20.
			$log_to = self::topic_to_address( (string) $topics[2] );
			if ( '' === $to_norm || $log_to !== $to_norm ) {
				continue;
			}

			// Value is the non-indexed uint256 in `data`.
			$value_base = self::hex_to_decimal_string( isset( $log['data'] ) ? (string) $log['data'] : '0x0' );

			// value >= min required (big-number safe).
			if ( self::compare_amounts( $value_base, (string) $min_amount_base ) >= 0 ) {
				return array( 'value' => $value_base );
			}
		}

		return null;
	}

	/**
	 * Perform a JSON-RPC call.
	 *
	 * @param string            $method JSON-RPC method name.
	 * @param array<int,mixed>  $params Positional parameters.
	 * @return mixed The decoded `result` value (may be null for empty receipts).
	 *
	 * @throws Exception When the transport fails or the node returns a JSON-RPC error.
	 */
	private function rpc( $method, array $params ) {
		$body = wp_json_encode(
			array(
				'jsonrpc' => '2.0',
				'id'      => 1,
				'method'  => $method,
				'params'  => $params,
			)
		);

		$response = wp_remote_post(
			$this->rpc_url,
			array(
				'timeout'     => $this->timeout,
				'headers'     => array( 'Content-Type' => 'application/json' ),
				'body'        => $body,
				'data_format' => 'body',
			)
		);

		if ( is_wp_error( $response ) ) {
			throw new Exception( esc_html( $response->get_error_message() ) );
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			throw new Exception( esc_html( sprintf( 'RPC HTTP %d', $code ) ) );
		}

		$decoded = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( ! is_array( $decoded ) ) {
			throw new Exception( 'Malformed JSON-RPC response.' );
		}

		if ( isset( $decoded['error'] ) ) {
			$message = is_array( $decoded['error'] ) && isset( $decoded['error']['message'] )
				? (string) $decoded['error']['message']
				: 'Unknown JSON-RPC error.';
			throw new Exception( esc_html( $message ) );
		}

		// `result` may legitimately be null (e.g. receipt for an unmined tx).
		return array_key_exists( 'result', $decoded ) ? $decoded['result'] : null;
	}

	/**
	 * Build a normalized result array.
	 *
	 * @param string $status  One of CONFIRMED|PENDING|FAILED.
	 * @param string $message Human-readable explanation.
	 * @return array{status:string,message:string}
	 */
	private function result( $status, $message ) {
		return array(
			'status'  => $status,
			'message' => $message,
		);
	}

	/* --------------------------------------------------------------------- *
	 * Static helpers (pure, unit-testable).
	 * --------------------------------------------------------------------- */

	/**
	 * Validate a transaction hash (0x followed by exactly 64 hex chars).
	 *
	 * @param string $hash Candidate hash.
	 * @return bool True when well-formed.
	 */
	public static function is_tx_hash( $hash ) {
		return is_string( $hash ) && (bool) preg_match( '/^0x[0-9a-fA-F]{64}$/', $hash );
	}

	/**
	 * Lowercase and validate an EVM address; returns '' when not a valid address.
	 *
	 * @param string $address Candidate address (0x + 40 hex).
	 * @return string Lowercased 0x-address, or '' when invalid.
	 */
	public static function normalize_address( $address ) {
		$address = is_string( $address ) ? trim( $address ) : '';

		if ( ! preg_match( '/^0x[0-9a-fA-F]{40}$/', $address ) ) {
			return '';
		}

		return strtolower( $address );
	}

	/**
	 * Extract a 20-byte address from a 32-byte indexed topic (last 40 hex chars).
	 *
	 * @param string $topic 0x-prefixed 32-byte topic.
	 * @return string Lowercased 0x-address, or '' when it cannot be parsed.
	 */
	public static function topic_to_address( $topic ) {
		$topic = is_string( $topic ) ? strtolower( trim( $topic ) ) : '';
		$topic = self::strip_0x( $topic );

		if ( strlen( $topic ) < 40 || ! ctype_xdigit( $topic ) ) {
			return '';
		}

		return '0x' . substr( $topic, -40 );
	}

	/**
	 * Strip a leading 0x/0X prefix from a hex string.
	 *
	 * @param string $hex Hex string.
	 * @return string Hex without prefix.
	 */
	public static function strip_0x( $hex ) {
		$hex = (string) $hex;

		if ( 0 === stripos( $hex, '0x' ) ) {
			return substr( $hex, 2 );
		}

		return $hex;
	}

	/**
	 * Convert a (small) hex quantity to a PHP int.
	 *
	 * Intended for block numbers and status flags that comfortably fit in an
	 * int on 64-bit PHP. For arbitrary uint256 values use hex_to_decimal_string.
	 *
	 * @param string $hex 0x-prefixed hex quantity.
	 * @return int Integer value (0 on empty/invalid input).
	 */
	public static function hex_to_int( $hex ) {
		$hex = self::strip_0x( is_string( $hex ) ? trim( $hex ) : '' );

		if ( '' === $hex || ! ctype_xdigit( $hex ) ) {
			return 0;
		}

		return (int) hexdec( $hex );
	}

	/**
	 * Convert an arbitrary-width hex quantity to a base-10 decimal string.
	 *
	 * Uses bcmath when available for exactness on full uint256 values. The
	 * fallback performs base-16 → base-10 long division by hand, which is exact
	 * for any width and never overflows PHP's native int.
	 *
	 * @param string $hex 0x-prefixed hex quantity.
	 * @return string Decimal string (e.g. "19990000"); "0" on empty/invalid input.
	 */
	public static function hex_to_decimal_string( $hex ) {
		$hex = strtolower( self::strip_0x( is_string( $hex ) ? trim( $hex ) : '' ) );
		$hex = ltrim( $hex, '0' );

		if ( '' === $hex ) {
			return '0';
		}

		if ( ! ctype_xdigit( $hex ) ) {
			return '0';
		}

		if ( function_exists( 'bcadd' ) ) {
			$dec = '0';
			$len = strlen( $hex );
			for ( $i = 0; $i < $len; $i++ ) {
				$digit = hexdec( $hex[ $i ] );
				$dec   = bcadd( bcmul( $dec, '16' ), (string) $digit );
			}
			return $dec;
		}

		// bcmath-free fallback: repeatedly divide the hex digit array by 10.
		return self::hex_to_decimal_fallback( $hex );
	}

	/**
	 * Pure-PHP hex→decimal conversion (no bcmath) via repeated long division.
	 *
	 * @param string $hex Lowercased hex string without 0x and without leading zeros.
	 * @return string Decimal string.
	 */
	private static function hex_to_decimal_fallback( $hex ) {
		// Work on an array of hex digit values, dividing the whole number by 10
		// repeatedly and collecting remainders (which are the decimal digits).
		$digits = array();
		$len    = strlen( $hex );
		for ( $i = 0; $i < $len; $i++ ) {
			$digits[] = hexdec( $hex[ $i ] );
		}

		$decimal = '';

		while ( ! empty( $digits ) ) {
			$remainder = 0;
			$quotient  = array();

			foreach ( $digits as $value ) {
				$accumulator = $remainder * 16 + $value;
				$q           = intdiv( $accumulator, 10 );
				$remainder   = $accumulator % 10;

				// Skip leading zeros in the quotient.
				if ( ! empty( $quotient ) || 0 !== $q ) {
					$quotient[] = $q;
				}
			}

			$decimal = (string) $remainder . $decimal;
			$digits  = $quotient;
		}

		return '' === $decimal ? '0' : $decimal;
	}

	/**
	 * Compare two non-negative integer amount strings (big-number safe).
	 *
	 * @param string $a Left operand (decimal string).
	 * @param string $b Right operand (decimal string).
	 * @return int -1 if a<b, 0 if a==b, 1 if a>b.
	 */
	public static function compare_amounts( $a, $b ) {
		$a = self::normalize_int_string( $a );
		$b = self::normalize_int_string( $b );

		if ( function_exists( 'bccomp' ) ) {
			return (int) bccomp( $a, $b, 0 );
		}

		// String comparison fallback: compare by length, then lexically.
		$la = strlen( $a );
		$lb = strlen( $b );

		if ( $la !== $lb ) {
			return $la < $lb ? -1 : 1;
		}

		return strcmp( $a, $b ) <=> 0;
	}

	/**
	 * Normalise an integer string: digits only, no sign, no leading zeros.
	 *
	 * @param string $value Candidate integer string.
	 * @return string Normalised integer string ("0" when empty/invalid).
	 */
	private static function normalize_int_string( $value ) {
		$value = preg_replace( '/[^0-9]/', '', (string) $value );
		$value = ltrim( (string) $value, '0' );

		return '' === $value ? '0' : $value;
	}
}
