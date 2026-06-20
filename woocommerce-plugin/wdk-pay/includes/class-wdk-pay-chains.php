<?php
/**
 * Supported chains registry.
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WDK_Pay_Chains
 *
 * Static registry of the EVM chains supported for USDt settlement. Each entry
 * carries the human name, the numeric EVM chain id, the canonical USDt ERC-20
 * contract address on that chain, and the block explorer base URL used to build
 * transaction links in order notes.
 *
 * @package WDK_Pay
 */
class WDK_Pay_Chains {

	/**
	 * Supported chains keyed by short identifier.
	 *
	 * Token addresses are the canonical Tether USD (USDt) deployments per chain.
	 * Addresses are stored in their checksummed form for display but compared
	 * case-insensitively elsewhere.
	 *
	 * @return array<string,array{key:string,name:string,chainId:int,token:string,explorer:string}>
	 */
	public static function all() {
		return array(
			'ethereum' => array(
				'key'      => 'ethereum',
				'name'     => 'Ethereum',
				'chainId'  => 1,
				'token'    => '0xdAC17F958D2ee523a2206206994597C13D831ec7',
				'explorer' => 'https://etherscan.io',
			),
			'polygon'  => array(
				'key'      => 'polygon',
				'name'     => 'Polygon',
				'chainId'  => 137,
				'token'    => '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
				'explorer' => 'https://polygonscan.com',
			),
			'arbitrum' => array(
				'key'      => 'arbitrum',
				'name'     => 'Arbitrum One',
				'chainId'  => 42161,
				'token'    => '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
				'explorer' => 'https://arbiscan.io',
			),
		);
	}

	/**
	 * Get a single chain definition by key.
	 *
	 * @param string $key Chain key (e.g. "ethereum").
	 * @return array{key:string,name:string,chainId:int,token:string,explorer:string}|null Chain definition or null when unknown.
	 */
	public static function get( $key ) {
		$chains = self::all();
		$key    = is_string( $key ) ? strtolower( trim( $key ) ) : '';

		return isset( $chains[ $key ] ) ? $chains[ $key ] : null;
	}

	/**
	 * Get the list of chain keys for use in admin <select> options.
	 *
	 * @return array<string,string> Map of chain key => human label.
	 */
	public static function options() {
		$options = array();

		foreach ( self::all() as $key => $chain ) {
			$options[ $key ] = $chain['name'];
		}

		return $options;
	}

	/**
	 * Get the default USDt token address for a chain.
	 *
	 * @param string $key Chain key.
	 * @return string Token contract address, or empty string when the chain is unknown.
	 */
	public static function token_for( $key ) {
		$chain = self::get( $key );

		return $chain ? $chain['token'] : '';
	}

	/**
	 * Get the numeric EVM chain id for a chain.
	 *
	 * @param string $key Chain key.
	 * @return int Numeric chain id, or 0 when the chain is unknown.
	 */
	public static function chain_id_for( $key ) {
		$chain = self::get( $key );

		return $chain ? (int) $chain['chainId'] : 0;
	}

	/**
	 * Build a block explorer URL for a transaction hash.
	 *
	 * @param string $key  Chain key.
	 * @param string $hash Transaction hash (0x-prefixed).
	 * @return string Fully qualified explorer URL, or empty string when the chain is unknown.
	 */
	public static function explorer_tx( $key, $hash ) {
		$chain = self::get( $key );

		if ( ! $chain || '' === $hash ) {
			return '';
		}

		return trailingslashit( $chain['explorer'] ) . 'tx/' . $hash;
	}

	/**
	 * Determine whether a chain key is supported.
	 *
	 * @param string $key Chain key.
	 * @return bool True when the chain is registered.
	 */
	public static function is_supported( $key ) {
		return null !== self::get( $key );
	}
}
