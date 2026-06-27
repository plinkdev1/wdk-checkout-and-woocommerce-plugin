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
				'assets'   => array(
					'usdt' => array(
						'symbol'   => 'USDt',
						'decimals' => 6,
						'token'    => '0xdAC17F958D2ee523a2206206994597C13D831ec7',
					),
					'xaut' => array(
						'symbol'   => 'XAUt',
						'decimals' => 6,
						'token'    => '0x68749665FF8D2d112Fa859AA293F07A622782F38',
					),
					'usdc' => array(
						'symbol'   => 'USDC',
						'decimals' => 6,
						'token'    => '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
					),
				),
			),
			'polygon'  => array(
				'key'      => 'polygon',
				'name'     => 'Polygon',
				'chainId'  => 137,
				'token'    => '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
				'explorer' => 'https://polygonscan.com',
				'assets'   => array(
					'usdt' => array(
						'symbol'   => 'USDt',
						'decimals' => 6,
						'token'    => '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
					),
					'usdc' => array(
						'symbol'   => 'USDC',
						'decimals' => 6,
						'token'    => '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
					),
				),
			),
			'arbitrum' => array(
				'key'      => 'arbitrum',
				'name'     => 'Arbitrum One',
				'chainId'  => 42161,
				'token'    => '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
				'explorer' => 'https://arbiscan.io',
				'assets'   => array(
					'usdt' => array(
						'symbol'   => 'USDt',
						'decimals' => 6,
						'token'    => '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
					),
					'usdc' => array(
						'symbol'   => 'USDC',
						'decimals' => 6,
						'token'    => '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
					),
				),
			),
		);
	}

	/**
	 * Human labels for every asset the plugin knows about, for admin <select>s.
	 * Availability is per-chain (see {@see asset()}); XAUt settles on Ethereum.
	 *
	 * @return array<string,string> Map of asset key => label.
	 */
	public static function asset_options() {
		return array(
			'usdt' => 'USDt — Tether USD',
			'xaut' => 'XAUt — Tether Gold',
			'usdc' => 'USDC — USD Coin',
		);
	}

	/**
	 * Resolve an asset on a chain. Falls back to the chain's USDt when the
	 * requested asset isn't deployed there, so a global "asset" setting can't
	 * strand a chain that lacks it.
	 *
	 * @param string $chain_key Chain key (e.g. "ethereum").
	 * @param string $asset_key Asset key (e.g. "usdt", "xaut").
	 * @return array{symbol:string,decimals:int,token:string}|null Asset, or null when the chain is unknown.
	 */
	public static function asset( $chain_key, $asset_key ) {
		$chain = self::get( $chain_key );

		if ( null === $chain ) {
			return null;
		}

		$asset_key = is_string( $asset_key ) ? strtolower( trim( $asset_key ) ) : 'usdt';
		$assets    = isset( $chain['assets'] ) ? $chain['assets'] : array();

		if ( isset( $assets[ $asset_key ] ) ) {
			return $assets[ $asset_key ];
		}

		// Requested asset not on this chain — fall back to USDt.
		return isset( $assets['usdt'] ) ? $assets['usdt'] : null;
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
	 * Reverse lookup: the registry chain key for a numeric EVM chain id.
	 *
	 * Used by the multi-chain flow to recover an explorer/label for a chain the
	 * shopper paid on. Returns '' when the chain id is not in the built-in
	 * registry (e.g. a merchant-added "additional chain"), in which case callers
	 * degrade gracefully (no explorer link).
	 *
	 * @param int $chain_id Numeric EVM chain id.
	 * @return string Chain key (e.g. "polygon"), or '' when unknown.
	 */
	public static function key_for_chain_id( $chain_id ) {
		$chain_id = (int) $chain_id;

		foreach ( self::all() as $key => $chain ) {
			if ( (int) $chain['chainId'] === $chain_id ) {
				return $key;
			}
		}

		return '';
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
