// Bundles the auto-mount widget to a single IIFE the WooCommerce plugin loads.
// `ethers` is referenced only as a type and resolved from the page global at
// runtime, so it is never bundled; qrcode-generator is bundled in.
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const outfile = '../../woocommerce-plugin/wdk-pay/assets/js/wdk-checkout.js'
mkdirSync('../../woocommerce-plugin/wdk-pay/assets/js', { recursive: true })

const result = await build({
  entryPoints: ['src/auto.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2018',
  platform: 'browser',
  minify: true,
  legalComments: 'none',
  banner: { js: '/* wdk-checkout widget — self-custodial USDt checkout, built on Tether WDK. MIT. */' },
  write: false // keep the output in memory so we can both write it and inline it
})
const js = result.outputFiles[0].text
writeFileSync(outfile, js)
console.log('Built', outfile)

// Inline the widget into the standalone demo so the single file works when it's
// opened directly (file://) or downloaded on its own — no repo checkout / static
// server needed. Replaces whatever sits between the wdk-widget markers, so this
// stays in sync on every build.
const demoPath = '../../examples/checkout-demo.html'
try {
  const html = readFileSync(demoPath, 'utf8')
  const re = /<!-- wdk-widget:start -->[\s\S]*?<!-- wdk-widget:end -->/
  if (re.test(html)) {
    // `</script>` inside a string literal would close the inline tag early — escape it.
    const safe = js.replace(/<\/script>/gi, '<\\/script>')
    const block = `<!-- wdk-widget:start -->\n  <script>\n${safe}\n  </script>\n  <!-- wdk-widget:end -->`
    writeFileSync(demoPath, html.replace(re, block))
    console.log('Inlined widget into', demoPath, '(self-contained demo)')
  } else {
    console.warn('demo markers not found; skipped inlining')
  }
} catch (err) {
  console.warn('demo inline skipped:', err.message)
}
