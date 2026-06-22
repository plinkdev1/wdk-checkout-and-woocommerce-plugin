# Contributing

Thanks for your interest in **WDK Pay** — the self-custodial USDt checkout for
WooCommerce. This guide covers how to set up the repo, build and test, the code
style we follow, and how to open a good pull request.

By contributing you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).

## Repository layout

This is a small monorepo. There is **no root workspace manifest**: each package
is self-contained and built independently with npm.

```
.
├── packages/
│   ├── wdk-checkout/            # the headless checkout SDK + widget (TypeScript)
│   │   ├── src/                 # source (widget, usdt, x402, pricing, swap, …)
│   │   ├── build.mjs            # bundles the widget asset for the plugin
│   │   └── examples/            # runnable, copy-paste examples
│   └── wdk-payment-verifier/    # server-side on-chain confirmation (TypeScript)
├── woocommerce-plugin/
│   └── wdk-pay/                 # the WooCommerce payment gateway (PHP)
│       └── assets/js/wdk-checkout.js   # the BUILT widget asset (generated)
├── examples/                    # repo-level x402 examples (Worker + Express)
└── docs/                        # architecture, setup, rails, security
```

## Prerequisites

- **Node.js >= 20** (see each package's `engines` field).
- **npm** (the lockfile-free `npm install` flow used in CI). `pnpm` works too if
  you prefer — there is no committed lockfile, so use whichever you like locally.
- **PHP 8.1+** only if you touch the WooCommerce plugin (for `php -l` linting).

## Dev setup

Each TypeScript package installs and builds on its own:

```bash
# the checkout SDK + widget
cd packages/wdk-checkout
npm install
npm run build        # build:types (tsc → dist/) + build:widget (bundle the asset)

# the server-side verifier
cd ../wdk-payment-verifier
npm install
npm run build
```

There is no top-level `npm install` — run it inside the package you are working
on.

## Building

In `packages/wdk-checkout`:

| Command | What it does |
|---|---|
| `npm run build` | Full build: types + widget asset. |
| `npm run build:types` | `tsc` → `dist/` (the published ESM + `.d.ts`). |
| `npm run build:widget` | `node build.mjs` → the bundled plugin asset (see below). |
| `npm run typecheck` | `tsc --noEmit`. |

`packages/wdk-payment-verifier` just exposes `npm run build` (`tsc`) and
`npm run typecheck`.

### Rebuilding the WooCommerce plugin asset

The plugin does not bundle source — it loads one pre-built file. `build.mjs`
(invoked by `npm run build:widget`, and transitively by `npm run build`) uses
esbuild to bundle `packages/wdk-checkout/src/auto.ts` into a single minified
IIFE at:

```
woocommerce-plugin/wdk-pay/assets/js/wdk-checkout.js
```

`ethers` is referenced only as a type and resolved from the page global at
runtime, so it is never bundled; `qrcode-generator` is bundled in.

**Important:** that asset is committed to the repo, and CI fails if it is out of
sync with the source. Whenever you change anything under `packages/wdk-checkout/src`
that affects the widget, rebuild and commit the regenerated asset:

```bash
cd packages/wdk-checkout
npm run build
# commit the updated woocommerce-plugin/wdk-pay/assets/js/wdk-checkout.js
```

CI enforces this with `git diff --exit-code` on the asset after building.

## Testing

Tests use [Vitest](https://vitest.dev/). Every rail is unit-tested in
`packages/wdk-checkout/src/*.spec.ts`.

```bash
cd packages/wdk-checkout
npm test                 # vitest run (one-shot, used by CI)

# during development:
npx vitest               # watch mode
npx vitest run pricing   # a single spec by name
```

The verifier package has the same `npm test` script.

Please add or update tests alongside any behavior change, and make sure
`npm run typecheck` is clean.

## Continuous integration

CI (`.github/workflows/ci.yml`) runs on every push and pull request:

- **`php-lint`** — `php -l` over every plugin PHP file.
- **`widget`** — in `packages/wdk-checkout`: `npm install`, `npm run typecheck`,
  `npm run build`, then `git diff --exit-code` on the built widget asset to make
  sure it was regenerated and committed.

Run these locally before pushing to avoid a red build.

## Code style

The TypeScript is framework-free and intentionally dependency-light. Match the
existing files:

- **2-space indentation.**
- **No semicolons** (the rail modules — `pricing`, `swap`, `subscriptions`,
  `lightning`, `types`, `widget` — are the canonical style; follow them for new
  code).
- **Single quotes** for strings.
- **Explicit, exported types/interfaces** with short doc comments. Public
  functions get a `/** … */` describing intent, params, and return.
- **Exact money math only** — amounts are token **base units** as integer
  strings, and all arithmetic uses `BigInt`/string. Never use floating point on
  an amount a customer is charged.
- **No hard-coded keys, RPC URLs, or endpoints** in the rails. Rate feeds, DEX
  quotes, and Lightning backends are injected via interfaces (`RateSource`,
  `SwapQuoteProvider`, `LightningProvider`) so nothing is baked in.
- **`fetch` is injectable** in modules that do I/O (an `fetchImpl` option), so
  they stay testable and runnable off-browser.

There is no committed linter/formatter config; keep diffs minimal and consistent
with the file you are editing.

### PHP (plugin)

Follow WordPress/WooCommerce conventions and keep the plugin lintable with
`php -l`. Class files live under `woocommerce-plugin/wdk-pay/includes/`.

## Commit & PR conventions

- **Branch** off `main`; do not push directly to `main`.
- **Commit messages**: short imperative subject (e.g. `widget: clear redirect
  timer on teardown`). A `type:` or `scope:` prefix is welcome but not required.
  Keep each commit focused.
- **One logical change per PR.** Describe *what* changed and *why*, and link any
  related issue.
- If you change the widget source, **rebuild and commit the plugin asset** in
  the same PR (CI will reject it otherwise).
- Update **tests**, the package **`CHANGELOG.md`** (under `## [Unreleased]`), and
  any affected **docs** when your change is user-visible.
- Make sure `npm run typecheck`, `npm test`, and `npm run build` all pass in the
  package(s) you touched.

## Reporting issues

Use the [issue tracker](https://github.com/plinkdev1/wdk-checkout-and-woocommerce-plugin/issues).
For anything security-sensitive, please review [`docs/SECURITY.md`](./docs/SECURITY.md)
and avoid filing exploit details in a public issue.

## License

Built with [Tether WDK](https://docs.wallet.tether.io). A community reference
implementation; not an official Tether product.
