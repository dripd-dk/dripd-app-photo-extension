/**
 * The viewfinder: where it sits, what it decides the user framed, and the button
 * wiring.
 *
 * Rects come from a `data-rect="left,top,width,height"` attribute rather than from
 * layout, because happy-dom does no layout at all — every real element would
 * report 0×0 and every selection test would pass vacuously.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cutoutRect,
  HINT_RESERVE,
  framedImage,
  framedUrls,
  markFramed,
  mountFrameOverlay,
  HOST_ID,
  LOADING_HOST_ID,
} from '../src/injected/frame'
import type { RawHarvest } from '../src/protocol'

const realRect = Element.prototype.getBoundingClientRect

beforeEach(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const raw = this.getAttribute('data-rect')
    const [left, top, width, height] = (raw ?? '0,0,0,0').split(',').map(Number) as [
      number,
      number,
      number,
      number,
    ]
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    } as DOMRect
  }
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect
  document.getElementById(HOST_ID)?.remove()
  document.body.innerHTML = ''
})

function viewport(width: number, height: number): Window {
  return { innerWidth: width, innerHeight: height } as Window
}

describe('cutoutRect', () => {
  // A desktop popup is landscape; a 3:4 frame wasted most of it and made the
  // user hunt for a narrow strip. The frame is a scaled copy of the window now.
  it.each([
    ['landscape desktop', 1280, 960],
    ['wide', 1920, 900],
    ['narrow and tall', 360, 1200],
  ])('carries the window aspect ratio (%s)', (_label, vw, vh) => {
    const r = cutoutRect(viewport(vw, vh))

    expect(r.width / r.height).toBeCloseTo(vw / vh, 5)
    expect(r.left + r.width / 2).toBeCloseTo(vw / 2, 5)
  })

  it('fills most of the window without colliding with the chrome around it', () => {
    const r = cutoutRect(viewport(1280, 960))

    // "Way bigger" is the requirement, so hold a floor on it: anything much
    // under this and the frame is back to being a strip in the middle.
    expect(r.width).toBeGreaterThan(1280 * 0.7)
    expect(r.height).toBeGreaterThan(960 * 0.7)

    // The bar owns the bottom of the viewport; the frame must not sit under it.
    expect(r.top + r.height).toBeLessThanOrEqual(960 - 100)
    // And the hint pill above it must not end up behind a sticky site header,
    // which is exactly what a too-small reserve produced.
    expect(r.top).toBeGreaterThanOrEqual(HINT_RESERVE)
  })

  it('stays inside the window it is scaled from', () => {
    for (const [vw, vh] of [
      [1280, 960],
      [1920, 900],
      [360, 1200],
      [320, 240],
    ] as const) {
      const r = cutoutRect(viewport(vw, vh))
      expect(r.width).toBeGreaterThan(0)
      expect(r.height).toBeGreaterThan(0)
      expect(r.left).toBeGreaterThanOrEqual(0)
      expect(r.left + r.width).toBeLessThanOrEqual(vw + 0.001)
    }
  })
})

describe('framedImage', () => {
  const RECT = { left: 100, top: 100, width: 300, height: 400 }

  function img(rect: string, attrs = ''): string {
    return `<img data-rect="${rect}" src="https://cdn.test/${rect}.jpg" ${attrs}>`
  }

  it('picks the photo filling the frame over a thumbnail sitting inside it', () => {
    document.body.innerHTML = img('100,100,300,400') + img('150,150,100,100')

    const picked = framedImage(document, RECT)

    expect(picked?.getAttribute('data-rect')).toBe('100,100,300,400')
  })

  it('ignores a neighbour that only clips the edge', () => {
    // 20px of a 300px-wide tile overlapping the frame is the related-products
    // rail scrolling past, not the photograph the user lined up.
    document.body.innerHTML = img('380,100,300,400')

    expect(framedImage(document, RECT)).toBeNull()
  })

  it('accepts a small image the user centred, because a thumbnail upgrades', () => {
    document.body.innerHTML = img('150,150,100,100')

    expect(framedImage(document, RECT)?.getAttribute('data-rect')).toBe('150,150,100,100')
  })

  it('breaks a tie on decoded resolution', () => {
    document.body.innerHTML =
      img('100,100,300,400', 'width="595" height="893" id="big"') +
      img('100,100,300,400', 'width="116" height="174" id="small"')

    expect(framedImage(document, RECT)?.id).toBe('big')
  })

  it('returns null when nothing is in the frame', () => {
    document.body.innerHTML = img('0,0,10,10')
    expect(framedImage(document, RECT)).toBeNull()
  })

  it('skips images with no box at all', () => {
    document.body.innerHTML = '<img src="https://cdn.test/hidden.jpg">'
    expect(framedImage(document, RECT)).toBeNull()
  })
})

describe('framedUrls and markFramed', () => {
  it('records every URL collect would have recorded for the element', () => {
    document.body.innerHTML = `
      <img src="/a.jpg" srcset="/a-small.jpg 200w, /a-large.jpg 1200w" data-rect="0,0,10,10">`
    const el = document.querySelector('img')!
    // The same base `collect` passes, because the two must agree exactly: `src`
    // is already absolute against the document, `srcset` is not.
    const base = document.location.href
    const abs = (p: string) => new URL(p, base).href

    const urls = framedUrls(el, base)

    expect(urls).toContain(abs('/a.jpg'))
    expect(urls).toContain(abs('/a-large.jpg'))
    // Only the widest rendition, matching collect's `bestFromSrcset`.
    expect(urls).not.toContain(abs('/a-small.jpg'))
  })

  it('flags every entry belonging to the framed element', () => {
    // One element, three harvest rows — the server may rank any of them, so the
    // user's choice has to survive on all three or it does not survive at all.
    const harvest: RawHarvest = {
      pageUrl: 'https://shop.test/p/1',
      title: null,
      jsonld: [],
      og: [],
      images: [
        { url: 'https://cdn.test/a.jpg', w: 1, h: 1 },
        { url: 'https://cdn.test/a-large.jpg', w: 1, h: 1 },
        { url: 'https://cdn.test/other.jpg', w: 1, h: 1 },
      ],
    }

    const n = markFramed(harvest, ['https://cdn.test/a.jpg', 'https://cdn.test/a-large.jpg'])

    expect(n).toBe(2)
    expect(harvest.images.filter((i) => i.framed).map((i) => i.url)).toEqual([
      'https://cdn.test/a.jpg',
      'https://cdn.test/a-large.jpg',
    ])
  })

  it('flags nothing when the framed element was never collected', () => {
    const harvest: RawHarvest = {
      pageUrl: 'https://shop.test/p/1',
      title: null,
      jsonld: [],
      og: [],
      images: [{ url: 'https://cdn.test/a.jpg', w: 1, h: 1 }],
    }

    expect(markFramed(harvest, [])).toBe(0)
    expect(harvest.images[0]!.framed).toBeUndefined()
  })
})

describe('mountFrameOverlay', () => {
  function mount(overrides: Partial<{ onGrab: () => void; onCancel: () => void }> = {}) {
    return mountFrameOverlay({ onGrab: () => {}, onCancel: () => {}, ...overrides })
  }

  function shadow() {
    return document.getElementById(HOST_ID)!.shadowRoot!
  }

  it('leaves the page usable underneath', () => {
    mount()
    // Everything but the button bar must let a scroll or a click through, or the
    // user cannot reach the carousel they are being asked to operate.
    expect(document.getElementById(HOST_ID)!.getAttribute('style')).toContain(
      'pointer-events:none',
    )
    expect(shadow().querySelector('.bar')).not.toBeNull()
  })

  it('replaces itself rather than stacking a second scrim', () => {
    mount()
    mount()

    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1)
  })

  it('calls back when the buttons are pressed', () => {
    const onGrab = vi.fn()
    const onCancel = vi.fn()
    mount({ onGrab, onCancel })

    shadow().querySelector<HTMLButtonElement>('[data-dripd="grab"]')!.click()
    shadow().querySelector<HTMLButtonElement>('[data-dripd="cancel"]')!.click()

    expect(onGrab).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('locks the button while working and offers a retry afterwards', () => {
    const overlay = mount()
    const grab = shadow().querySelector<HTMLButtonElement>('[data-dripd="grab"]')!

    overlay.setState('busy')
    expect(grab.disabled).toBe(true)

    overlay.setState('sent')
    // Still there on purpose: an empty ranking sends the user back to re-frame.
    expect(grab.disabled).toBe(false)
    expect(grab.textContent).toBe('Hent igen')
  })

  it('takes itself off the page on destroy', () => {
    mount().destroy()
    expect(document.getElementById(HOST_ID)).toBeNull()
  })

  it('draws the frame edge in both tones', () => {
    // Regression guard, and the one thing 82 tests missed: with a single white
    // edge over a 20% scrim the frame was invisible on a white retailer page and
    // only appeared once a dark photo scrolled under it. happy-dom does no paint,
    // so contrast itself is untestable — what is testable is that the edge still
    // declares a light component and a dark one.
    mount()
    const css = shadow().querySelector('style')!.textContent!
    const rule = css.slice(css.indexOf('.cutout {'), css.indexOf('.tick {'))

    expect(rule).toMatch(/rgba\(255,\s*255,\s*255/)
    expect(rule).toMatch(/rgba\(20,\s*19,\s*17,\s*0\.5\)/)
  })
})

describe('the loading scrim', () => {
  it('is taken down by the viewfinder that replaces it', () => {
    // The scrim's whole job is to stop the retailer page being visible without a
    // viewfinder over it. Removing it here — in the same document, right after
    // the overlay is built — is what leaves no frame in between.
    const scrim = document.createElement('div')
    scrim.id = LOADING_HOST_ID
    document.documentElement.appendChild(scrim)

    mountFrameOverlay({ onGrab: () => {}, onCancel: () => {} })

    expect(document.getElementById(LOADING_HOST_ID)).toBeNull()
    expect(document.getElementById(HOST_ID)).not.toBeNull()
  })

  it('mounts fine when no scrim was ever injected', () => {
    expect(() => mountFrameOverlay({ onGrab: () => {}, onCancel: () => {} })).not.toThrow()
  })
})
