<?php
/**
 * Plugin Name:       WDK Pay — Self-Custodial USDt Checkout
 * Plugin URI:        https://github.com/tetherto/wdk
 * Description:       Accept self-custodial USDt payments from a WDK-powered wallet at WooCommerce checkout, with on-chain verification over JSON-RPC. Customers pay USDt directly to your receiving address — funds never touch a custodian.
 * Version:           1.0.0
 * Author:            WDK Pay Contributors
 * Author URI:        https://tether.to
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wdk-pay
 * Domain Path:       /languages
 * Requires PHP:      8.0
 * Requires at least: 6.0
 * WC requires at least: 7.0
 * WC tested up to:   9.4
 *
 * @package WDK_Pay
 */

// Guard against direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Plugin version.
 *
 * @var string
 */
define( 'WDK_PAY_VERSION', '1.0.0' );

/**
 * Absolute path to the plugin directory (with trailing slash).
 *
 * @var string
 */
define( 'WDK_PAY_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );

/**
 * URL to the plugin directory (with trailing slash).
 *
 * @var string
 */
define( 'WDK_PAY_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

/**
 * Absolute path to the main plugin file.
 *
 * @var string
 */
define( 'WDK_PAY_PLUGIN_FILE', __FILE__ );

/**
 * Bootstrap the plugin once all plugins are loaded.
 *
 * WooCommerce must be active for the gateway to function. If it is not, we
 * surface an admin notice instead of fataling, so the site stays usable.
 *
 * @return void
 */
function wdk_pay_bootstrap() {
	// Ensure WooCommerce (and its gateway base class) is available.
	if ( ! class_exists( 'WooCommerce' ) || ! class_exists( 'WC_Payment_Gateway' ) ) {
		add_action( 'admin_notices', 'wdk_pay_woocommerce_missing_notice' );
		return;
	}

	require_once WDK_PAY_PLUGIN_DIR . 'includes/class-wdk-pay-chains.php';
	require_once WDK_PAY_PLUGIN_DIR . 'includes/class-wdk-pay-intent.php';
	require_once WDK_PAY_PLUGIN_DIR . 'includes/class-wdk-pay-verifier.php';
	require_once WDK_PAY_PLUGIN_DIR . 'includes/class-wdk-pay-rest.php';
	require_once WDK_PAY_PLUGIN_DIR . 'includes/class-wdk-pay-gateway.php';
	require_once WDK_PAY_PLUGIN_DIR . 'includes/class-wdk-pay.php';

	WDK_Pay::instance();
}
add_action( 'plugins_loaded', 'wdk_pay_bootstrap' );

/**
 * Render an admin notice when WooCommerce is not active.
 *
 * @return void
 */
function wdk_pay_woocommerce_missing_notice() {
	if ( ! current_user_can( 'activate_plugins' ) ) {
		return;
	}

	$message = sprintf(
		/* translators: %s: WooCommerce plugin name. */
		esc_html__( 'WDK Pay requires %s to be installed and active.', 'wdk-pay' ),
		'<strong>WooCommerce</strong>'
	);

	printf( '<div class="notice notice-error"><p>%s</p></div>', wp_kses_post( $message ) );
}

/**
 * Declare compatibility with WooCommerce High-Performance Order Storage (HPOS).
 *
 * @return void
 */
function wdk_pay_declare_hpos_compatibility() {
	if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
			'custom_order_tables',
			WDK_PAY_PLUGIN_FILE,
			true
		);
	}
}
add_action( 'before_woocommerce_init', 'wdk_pay_declare_hpos_compatibility' );
