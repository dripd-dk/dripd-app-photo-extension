import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findNextButton, harvestGallery, thumbnailSteps, findHero } from '../src/injected/gallery'

/**
 * happy-dom lays nothing out, so `getBoundingClientRect` is stubbed to read the
 * `width`/`height` attributes. Those attributes are also what `collect` reads for
 * decoded dimensions, so one number per element drives both.
 */
const realRect = Element.prototype.getBoundingClientRect

function stubRects(): void {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const w = Number(this.getAttribute('width') ?? this.getAttribute('data-w') ?? 0)
    const h = Number(this.getAttribute('height') ?? this.getAttribute('data-h') ?? 0)
    return { top: 0, bottom: h, left: 0, right: w, width: w, height: h, x: 0, y: 0 } as DOMRect
  }
}

const CDN = 'https://cdn.test'
const instant = { wait: () => Promise.resolve() }

function slide(asset: string, width = 595): string {
  return `<div class="slide"><img src="${CDN}/${asset}.jpg?imwidth=1260" width="${width}" height="${Math.round(width * 1.5)}"></div>`
}

function thumb(asset: string): string {
  return `<li><img src="${CDN}/${asset}.jpg?imwidth=116" width="116" height="174"></li>`
}

/** The measured H&M shape: three loaded mains, two 116px thumbnails, and three
 *  more photos that exist only inside the carousel's unloaded slides. */
function buildGallery(opts: { next?: boolean; thumbs?: boolean; linkThumbs?: boolean } = {}): {
  advance: () => void
  clicks: string[]
} {
  const { next = true, thumbs = true, linkThumbs = false } = opts

  document.head.innerHTML = `<meta property="og:image" content="${CDN}/a1.jpg?imwidth=657">`
  const thumbMarkup = thumbs
    ? `<ul id="thumbs">${linkThumbs ? `<li><a href="/other-product"><img src="${CDN}/other.jpg?imwidth=116" width="116" height="174"></a></li>` : ''}${thumb('a4')}${thumb('a5')}</ul>`
    : ''
  document.body.innerHTML = `
    <div id="gallery">
      <div id="track">${slide('a1')}${slide('a2')}${slide('a3')}</div>
      ${next ? '<button id="next" aria-label="Next image" width="40" height="40">›</button>' : ''}
      ${thumbMarkup}
    </div>
    <div id="related">
      <a href="/p/x"><img src="${CDN}/rel1.jpg?imwidth=396" width="396" height="594"></a>
      <a href="/p/y"><img src="${CDN}/rel2.jpg?imwidth=396" width="396" height="594"></a>
    </div>
  `

  // Slides the carousel has not mounted yet. Each successful advance mounts one,
  // which is what makes advancing worth doing at all.
  const unloaded = ['a6', 'a7', 'a8']
  const clicks: string[] = []
  const advance = () => {
    const asset = unloaded.shift()
    if (!asset) return
    document.getElementById('track')!.insertAdjacentHTML('beforeend', slide(asset))
  }

  document.addEventListener('click', (e) => {
    const el = e.target as Element
    clicks.push(el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ''))
  })

  return { advance, clicks }
}

describe('gallery advancing', () => {
  beforeEach(() => {
    stubRects()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect
    vi.restoreAllMocks()
  })

  it('finds the hero by og:image, ignoring the rendition parameter', () => {
    buildGallery()
    const hero = findHero(document, [`${CDN}/a1.jpg?imwidth=657`])
    expect(hero?.getAttribute('src')).toBe(`${CDN}/a1.jpg?imwidth=1260`)
  })

  it('treats only the small images as thumbnail handles', () => {
    buildGallery()
    const hero = findHero(document, [])
    const steps = thumbnailSteps(document.getElementById('gallery')!, hero)
    // Two 116px thumbs; the three 595px mains are gallery photos, not controls.
    expect(steps).toHaveLength(2)
  })

  it('never offers a handle that would navigate', () => {
    buildGallery({ linkThumbs: true })
    const steps = thumbnailSteps(document.getElementById('gallery')!, null)
    // The linked thumbnail is skipped: clicking an img inside an <a> follows the
    // link, and the popup would capture a different product.
    expect(steps).toHaveLength(2)
  })

  it('gains photos when the thumbnail strip drives the carousel', async () => {
    const { advance } = buildGallery({ next: false })
    document.getElementById('thumbs')!.addEventListener('click', advance)

    const result = await harvestGallery({ ...instant, doc: document, win: window })

    expect(result.strategies).toContain('thumbnail')
    expect(result.gained).toBeGreaterThanOrEqual(2)
    expect(result.harvest.images.map((i) => i.url)).toContain(`${CDN}/a6.jpg?imwidth=1260`)
  })

  it('falls through to the next button when thumbnails are inert', async () => {
    const { advance } = buildGallery()
    document.getElementById('next')!.addEventListener('click', advance)

    const result = await harvestGallery({ ...instant, doc: document, win: window })

    expect(result.strategies).toEqual(['next-button'])
    expect(result.gained).toBe(3)
    expect(result.harvest.images.map((i) => i.url)).toContain(`${CDN}/a8.jpg?imwidth=1260`)
  })

  it('falls through to the arrow key when nothing is clickable', async () => {
    const { advance } = buildGallery({ next: false })
    document.getElementById('track')!.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'ArrowRight') advance()
    })

    const result = await harvestGallery({ ...instant, doc: document, win: window })

    expect(result.strategies).toContain('arrow-key')
    expect(result.gained).toBe(3)
  })

  it('unions rather than replaces, so a slide that unmounts keeps its photo', async () => {
    const { advance } = buildGallery()
    document.getElementById('next')!.addEventListener('click', () => {
      // A real carousel recycles slides: the first one goes away as the next arrives.
      document.querySelector('#track .slide')?.remove()
      advance()
    })

    const urls = (await harvestGallery({ ...instant, doc: document, win: window })).harvest.images.map(
      (i) => i.url,
    )

    expect(urls).toContain(`${CDN}/a1.jpg?imwidth=1260`) // gone from the DOM
    expect(urls).toContain(`${CDN}/a6.jpg?imwidth=1260`) // arrived later
  })

  it('degrades to the fresh-load harvest on a carousel that does not respond', async () => {
    buildGallery() // nothing wired: every click and key is ignored

    const result = await harvestGallery({ ...instant, doc: document, win: window })

    expect(result.gained).toBe(0)
    expect(result.strategies).toEqual([])
    // Bounded, and it terminated — a hang here is a 45 s bridge timeout.
    expect(result.advances).toBeLessThanOrEqual(8)
    expect(result.harvest.images.length).toBeGreaterThan(0)
  })

  it('honours the time budget before the advance count', async () => {
    const { advance } = buildGallery()
    document.getElementById('next')!.addEventListener('click', advance)

    let calls = 0
    const result = await harvestGallery({
      ...instant,
      doc: document,
      win: window,
      budgetMs: 4_000,
      now: () => (calls++ === 0 ? 0 : 9_999), // the clock jumps past the budget
    })

    expect(result.advances).toBe(0)
    expect(result.harvest.images.length).toBeGreaterThan(0)
  })

  it('never scrolls the page', async () => {
    const { advance } = buildGallery()
    document.getElementById('next')!.addEventListener('click', advance)
    const scrollTo = vi.fn()
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    vi.stubGlobal('scrollTo', scrollTo)

    await harvestGallery({ ...instant, doc: document, win: window })

    // Scrolling this page adds zero gallery photos and nine unrelated product
    // cards — measured on H&M, 2026-08-14.
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not mistake a previous-arrow for a next-arrow', () => {
    document.body.innerHTML = `
      <div id="g">
        <img src="${CDN}/a1.jpg" width="595" height="893">
        <button id="prev" aria-label="Previous image" width="40" height="40">‹</button>
        <button id="fwd" aria-label="Next image" width="40" height="40">›</button>
      </div>
    `
    expect(findNextButton(document.getElementById('g')!, document)?.id).toBe('fwd')
  })

  it('skips a disabled next arrow', () => {
    document.body.innerHTML = `
      <div id="g">
        <button id="next" aria-label="Next" disabled width="40" height="40">›</button>
      </div>
    `
    expect(findNextButton(document.getElementById('g')!, document)).toBeNull()
  })
})
