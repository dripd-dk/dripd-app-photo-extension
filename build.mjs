// Build the extension into dist/.
//
// Four bundles, all plain IIFEs with no module syntax and no minification:
//
//  - `sw.js`        the background context. Classic script, so the ONE file works
//                   as both Chromium's `service_worker` and Firefox's
//                   `background.scripts` entry. Declaring `"type": "module"`
//                   would have split those two.
//  - `bridge.js`    the content script on dripd's origin.
//  - `injected.js`  injected into the retailer page by `scripting.executeScript`
//                   ({files}), which is why it can be a real bundle instead of one
//                   giant self-contained function. It installs
//                   `globalThis.__dripdHarvest` in the isolated world; the SW then
//                   calls it with a second, trivially self-contained `func`.
//  - `onboarding.js` the one-time permission page.
//
// Not minified on purpose: store reviewers read the shipped source, and an
// obfuscated bundle in a shopping-adjacent extension asking for https://*/* is
// how a review stalls.
//
// Flags:
//   --dev              also match localhost:3000, for testing against a dev server
//   --target=firefox   emit to dist-firefox/ (keeps browser_specific_settings)

import { build } from 'esbuild'
import { mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const dev = process.argv.includes('--dev')
const target = (process.argv.find((a) => a.startsWith('--target=')) || '').split('=')[1] || 'chrome'
// Three separate output directories so a dev build never leaves a localhost
// content script sitting in the folder you were about to submit to a store.
const outdir = resolve(root, target === 'firefox' ? 'dist-firefox' : dev ? 'dist-dev' : 'dist')

const DEV_MATCHES = ['http://localhost:3000/*', 'http://127.0.0.1:3000/*']

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

await build({
  entryPoints: [
    { in: resolve(root, 'src/sw.ts'), out: 'sw' },
    { in: resolve(root, 'src/bridge.content.ts'), out: 'bridge' },
    { in: resolve(root, 'src/injected/index.ts'), out: 'injected' },
    { in: resolve(root, 'src/onboarding.ts'), out: 'onboarding' },
  ],
  outdir,
  bundle: true,
  format: 'iife',
  target: ['chrome111', 'firefox121', 'safari16.4'],
  minify: false,
  sourcemap: false,
  legalComments: 'inline',
})

const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))

if (dev) {
  // The matches list is a security boundary — the extension is a CORS-bypass
  // proxy, so widening it is a deliberate, dev-only act, never a default.
  manifest.content_scripts[0].matches.push(...DEV_MATCHES)
  // Firefox MV3 makes host permissions opt-in, and a declared content script
  // does not run until its site is granted. The production grant is
  // `https://*/*`, which cannot cover an http dev server — so on Firefox the
  // dev build silently had no bridge at all, with nothing in the permissions UI
  // to switch on. Declaring them gives the user something to grant.
  manifest.optional_host_permissions.push(...DEV_MATCHES)
  manifest.name = 'dripd (dev)'
}

// `manifest.json` carries the union of both browsers' keys; each target drops the
// ones its browser would only warn about. The spec argued a single manifest could
// declare both background forms and skip the fork — true, but the fork exists
// anyway for Firefox's add-on id, so it may as well load without warnings.
if (target === 'chrome') {
  delete manifest.browser_specific_settings
  delete manifest.background.scripts // MV2-only in Chromium
} else {
  delete manifest.background.service_worker // Firefox bug 1573659
}

await writeFile(resolve(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await cp(resolve(root, 'src/onboarding.html'), resolve(outdir, 'onboarding.html'))
// The popup's first paint. Copied rather than bundled because it is markup and
// CSS only — MV3 forbids inline script on an extension page, so it has none.
await cp(resolve(root, 'src/loading.html'), resolve(outdir, 'loading.html'))
// Self-hosted so the grant page renders in dripd's own serif rather than a
// Georgia fallback. Bundled rather than fetched: a store reviewer reading this
// manifest should find no network access at all, and there is none.
await cp(resolve(root, 'src/fonts'), resolve(outdir, 'fonts'), { recursive: true })
// The stores all require an icon set, and Safari's converter refuses to build one
// without it. Sizes come from the brand logopack.
await cp(resolve(root, 'src/icons'), resolve(outdir, 'icons'), { recursive: true })

const matches = manifest.content_scripts[0].matches.join(', ')
console.log(`built ${target}${dev ? ' (dev)' : ''} → ${outdir}`)
console.log(`  bridge matches: ${matches}`)
