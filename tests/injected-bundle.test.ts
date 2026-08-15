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
 * It now also covers the wiring the redesign introduced: arming mounts a real
 * viewfinder, and the *button* — not a function call — is what sends the harvest
 * back. A grab path that works only when a test calls `grab()` directly would be
 * a dead extension too.
 *
 * `npm test` builds first, so this never runs against a stale bundle.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const BUNDLE = resolve(import.meta.dirname, '../dist/injected.js')
const CDN = 'https://cdn.test'
const SESSION = 'sess-1'

const realRect = Element.prototype.getBoundingClientRect

interface Framed {
  kind: string
  sessionId: string
  cancelled?: boolean
  harvest?: {
    images: { url: string; framed?: boolean }[]
    title: string | null
    meta: { consentDismissed: boolean; framed: boolean; framedMatches: number }
  }
}

const sent: Framed[] = []

function loadBundle(): { arm: (id: string) => Promise<void> } {
  const source = readFileSync(BUNDLE, 'utf8')
  delete (globalThis as { __dripdHarvest?: unknown }).__dripdHarvest
  new Function(source)()
  const installed = (globalThis as { __dripdHarvest?: { arm: (id: string) => Promise<void> } })
    .__dripdHarvest
  if (!installed) throw new Error('the bundle did not install __dripdHarvest')
  return installed
}

/** Press a button inside the overlay's shadow root, as a user would. */
function press(which: 'grab' | 'cancel'): void {
  const host = document.getElementById('__dripd_frame')
  if (!host?.shadowRoot) throw new Error('the overlay is not mounted')
  const button = host.shadowRoot.querySelector<HTMLButtonElement>(`[data-dripd="${which}"]`)
  if (!button) throw new Error(`no ${which} button in the overlay`)
  button.click()
}

describe('dist/injected.js', () => {
  beforeEach(() => {
    sent.length = 0
    ;(globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: (msg: Framed) => {
          sent.push(msg)
        },
      },
    }
    // Anchored top-left, sized from the attributes: enough for the viewfinder
    // geometry to have a real answer about what overlaps it.
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const w = Number(this.getAttribute('width') ?? 0)
      const h = Number(this.getAttribute('height') ?? 0)
      return { top: 0, bottom: h, left: 0, right: w, width: w, height: h, x: 0, y: 0 } as DOMRect
    }
  })

  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect
    delete (globalThis as { chrome?: unknown }).chrome
    document.getElementById('__dripd_frame')?.remove()
  })

  it('rejects the cookie wall, waits, and harvests only when the button is pressed', async () => {
    document.head.innerHTML = `<meta property="og:image" content="${CDN}/a1.jpg?imwidth=657">`
    document.title = 'Skjorte - Rød'
    document.body.innerHTML = `
      <div id="cmp"><button id="reject">Afvis alle</button><button id="accept">Accepter alle</button></div>
      <div id="gallery">
        <div id="track">
          <div><img src="${CDN}/a1.jpg?imwidth=1260" width="595" height="893"></div>
          <div><img src="${CDN}/a2.jpg?imwidth=1260" width="595" height="893"></div>
        </div>
        <ul id="thumbs">
          <li><img src="${CDN}/a4.jpg?imwidth=116" width="116" height="174"></li>
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

    await loadBundle().arm(SESSION)

    expect(accepted).toBe(false)
    // The whole change in one assertion: armed, mounted, and nothing collected.
    expect(document.getElementById('__dripd_frame')).not.toBeNull()
    expect(sent).toEqual([])

    press('grab')

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ kind: 'framed', sessionId: SESSION })
    const harvest = sent[0]!.harvest!
    expect(harvest.title).toBe('Skjorte - Rød')
    expect(harvest.meta.consentDismissed).toBe(true)

    // The thumbnail is off to the left of the viewfinder; the photo filling it is
    // the one the user framed, and it is the only entry that carries the flag.
    expect(harvest.meta.framed).toBe(true)
    expect(harvest.meta.framedMatches).toBe(1)
    expect(harvest.images.filter((i) => i.framed).map((i) => i.url)).toEqual([
      `${CDN}/a1.jpg?imwidth=1260`,
    ])
  }, 20_000)

  it('reports a cancel instead of a harvest, and takes the overlay down', async () => {
    document.head.innerHTML = ''
    document.body.innerHTML = `<img src="${CDN}/lonely.jpg?imwidth=1260" width="595" height="893">`

    await loadBundle().arm(SESSION)
    press('cancel')

    expect(sent).toEqual([{ __dripd: true, kind: 'framed', sessionId: SESSION, cancelled: true }])
    expect(document.getElementById('__dripd_frame')).toBeNull()
  }, 20_000)

  it('still harvests a page with nothing in the viewfinder', async () => {
    document.head.innerHTML = ''
    // 10×10 at the top-left corner: real, collectable, and nowhere near the frame.
    document.body.innerHTML = `<img src="${CDN}/tiny.jpg?imwidth=10" width="10" height="10">`

    await loadBundle().arm(SESSION)
    press('grab')

    const harvest = sent[0]!.harvest!
    expect(harvest.images.map((i) => i.url)).toEqual([`${CDN}/tiny.jpg?imwidth=10`])
    // Nothing framed is not nothing harvested — the studio still gets a page to
    // rank, and the picker is what recovers from a badly-aimed grab.
    expect(harvest.meta.framed).toBe(false)
    expect(harvest.meta.framedMatches).toBe(0)
  }, 20_000)
})
