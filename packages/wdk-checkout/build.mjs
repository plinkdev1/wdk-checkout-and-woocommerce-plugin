// Bundles the auto-mount widget to a single IIFE the WooCommerce plugin loads.
// `ethers` is referenced only as a type and resolved from the page global at
// runtime, so it is never bundled; qrcode-generator is bundled in.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

const outfile = '../../woocommerce-plugin/wdk-pay/assets/js/wdk-checkout.js'
mkdirSync('../../woocommerce-plugin/wdk-pay/assets/js', { recursive: true })

await build({
  entryPoints: ['src/auto.ts'],
  outfile,
  bundle: true,
  format: 'iife',
  target: 'es2018',
  platform: 'browser',
  minify: true,
  legalComments: 'none',
  banner: { js: '/* wdk-checkout widget — self-custodial USDt checkout, built on Tether WDK. MIT. */' }
})

console.log('Built', outfile)
