/**
 * What the build actually put in `dist/`.
 *
 * The router opens the popup on `loading.html` by name, through
 * `runtime.getURL`. Nothing in the type system or the unit tests connects that
 * string to a file: a build that forgot to copy the page would pass every other
 * test in this repo and open every capture on a blank error page.
 *
 * `npm test` builds first, so this never runs against a stale `dist/`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIST = resolve(import.meta.dirname, '../dist')

describe('the built extension', () => {
  it('ships the loading page the popup opens on', () => {
    expect(existsSync(resolve(DIST, 'loading.html'))).toBe(true)
  })

  it('needs no script in that page, so the extension CSP cannot block it', () => {
    // MV3 forbids inline script on extension pages. The page is markup and CSS
    // only; a `<script>` here would render a blank popup in Firefox and Safari
    // with nothing but a console error to say why.
    expect(readFileSync(resolve(DIST, 'loading.html'), 'utf8')).not.toContain('<script')
  })
})
