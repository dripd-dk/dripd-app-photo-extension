/**
 * The BUILT bundle, evaluated the way the browser evaluates it.
 *
 * The unit tests import the modules; this one runs `dist/injected.js` through
 * `new Function`, which is the closest thing to `executeScript({ files })` that a
 * test can do. It is here to catch the class of failure unit tests structurally
 * cannot see: a bundle that references something the build did not include, or an
 * entry point that never installs `__dripdHarvest` — either of which would ship a
 * working set of modules and a dead extension.
 *
 * `npm test` builds first, so this never runs against a stale bundle.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const BUNDLE = resolve(import.meta.dirname, '../dist/injected.js')
const CDN = 'https://cdn.test'

const realRect = Element.prototype.getBoundingClientRect

interface Harvested {
  images: { url: string }[]
  title: string | null
  meta: { consentDismissed: boolean; advances: number; strategies: string[]; gained: number }
}

function loadBundle(): { run: () => Promise<Harvested> } {
  const source = readFileSync(BUNDLE, 'utf8')
  delete (globalThis as { __dripdHarvest?: unknown }).__dripdHarvest
  new Function(source)()
  const installed = (globalThis as { __dripdHarvest?: { run: () => Promise<Harvested> } })
    .__dripdHarvest
  if (!installed) throw new Error('the bundle did not install __dripdHarvest')
  return installed
}

describe('dist/injected.js', () => {
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const w = Number(this.getAttribute('width') ?? 0)
      const h = Number(this.getAttribute('height') ?? 0)
      return { top: 0, bottom: h, left: 0, right: w, width: w, height: h, x: 0, y: 0 } as DOMRect
    }
  })

  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect
  })

  it('rejects the cookie wall, harvests, and advances the gallery', async () => {
    document.head.innerHTML = `<meta property="og:image" content="${CDN}/a1.jpg?imwidth=657">`
    document.title = 'Skjorte - Rød'
    document.body.innerHTML = `
      <div id="cmp"><button id="reject">Afvis alle</button><button id="accept">Accepter alle</button></div>
      <div id="gallery">
        <div id="track">
          <div><img src="${CDN}/a1.jpg?imwidth=1260" width="595" height="893"></div>
          <div><img src="${CDN}/a2.jpg?imwidth=1260" width="595" height="893"></div>
          <div><img src="${CDN}/a3.jpg?imwidth=1260" width="595" height="893"></div>
        </div>
        <ul id="thumbs">
          <li><img src="${CDN}/a4.jpg?imwidth=116" width="116" height="174"></li>
          <li><img src="${CDN}/a5.jpg?imwidth=116" width="116" height="174"></li>
        </ul>
      </div>
      <script type="application/ld+json">{"@type":"Product","name":"Skjorte","offers":{"price":"429"}}</script>
    `

    let accepted = false
    document.getElementById('accept')!.addEventListener('click', () => {
      accepted = true
    })
    document.getElementById('cmp')!.addEventListener('click', (e) => {
      if ((e.target as Element).id === 'reject') document.getElementById('cmp')!.remove()
    })

    // The sixth photo exists only in a slide the carousel has not mounted.
    let mounted = false
    document.getElementById('thumbs')!.addEventListener('click', () => {
      if (mounted) return
      mounted = true
      document
        .getElementById('track')!
        .insertAdjacentHTML(
          'beforeend',
          `<div><img src="${CDN}/a6.jpg?imwidth=1260" width="595" height="893"></div>`,
        )
    })

    const result = await loadBundle().run()

    expect(accepted).toBe(false)
    expect(result.meta.consentDismissed).toBe(true)
    expect(result.title).toBe('Skjorte - Rød')
    expect(result.meta.gained).toBe(1)
    expect(result.images.map((i) => i.url)).toContain(`${CDN}/a6.jpg?imwidth=1260`)
  }, 20_000)

  it('still returns a harvest on a page with no gallery at all', async () => {
    document.head.innerHTML = ''
    document.body.innerHTML = `<img src="${CDN}/lonely.jpg?imwidth=1260" width="595" height="893">`

    const result = await loadBundle().run()

    expect(result.images.map((i) => i.url)).toEqual([`${CDN}/lonely.jpg?imwidth=1260`])
    expect(result.meta.advances).toBe(0)
  }, 20_000)
})
