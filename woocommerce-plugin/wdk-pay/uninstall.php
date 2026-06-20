<?php
/**
 * Uninstall routine for WDK Pay.
 *
 * Runs when the plugin is deleted from the WordPress admin. Removes the
 * gateway's persisted options. Order meta (tx hashes, payment status) is
 * intentionally preserved as part of the order audit trail.
 *
 * @package WDK_Pay
 */

// Only run in the context of a genuine WordPress uninstall.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

/**
 * Delete the gateway settings option for a single site.
 *
 * @return void
 */
function wdk_pay_delete_site_options() {
	// WooCommerce stores gateway settings under this option key.
	delete_option( 'woocommerce_wdk_pay_settings' );
}

if ( is_multisite() ) {
	$site_ids = get_sites( array( 'fields' => 'ids' ) );

	foreach ( $site_ids as $site_id ) {
		switch_to_blog( (int) $site_id );
		wdk_pay_delete_site_options();
		restore_current_blog();
	}
} else {
	wdk_pay_delete_site_options();
}
