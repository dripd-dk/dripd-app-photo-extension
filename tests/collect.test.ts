import { beforeEach, describe, expect, it } from 'vitest'
import { bestFromSrcset, collect } from '../src/injected/collect'

/** happy-dom does not load images, so `naturalWidth` is always 0. Fake the
 *  decoded dimensions the way a browser would report them. */
function setDecoded(img: HTMLImageElement, w: number, h: number): void {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true })
}

function setRect(el: Element, rect: Partial<DOMRect>): void {
  el.getBoundingClientRect = () =>
    ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, ...rect }) as DOMRect
}

describe('bestFromSrcset', () => {
  it('takes the widest descriptor', () => {
    expect(
      bestFromSrcset('/a.jpg?imwidth=400 400w, /a.jpg?imwidth=2160 2160w, /a.jpg?imwidth=800 800w'),
    ).toBe('/a.jpg?imwidth=2160')
  })

  it('survives a srcset with no descriptors', () => {
    expect(bestFromSrcset('/only.jpg')).toBe('/only.jpg')
  })

  it('is null on empty input', () => {
    expect(bestFromSrcset('')).toBeNull()
  })
})

describe('collect', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  it('reads src, srcset and picture sources, absolutised', () => {
    document.body.innerHTML = `
      <img id="main" src="/img/main.jpg?imwidth=1260"
           srcset="/img/main.jpg?imwidth=1260 1260w, /img/main.jpg?imwidth=2160 2160w">
      <picture>
        <source srcset="/img/alt.webp?imwidth=800 800w" type="image/webp">
        <img id="alt" src="/img/alt.jpg">
      </picture>
    `
    const urls = collect(document, window).images.map((i) => i.url)

    expect(urls).toContain(`${location.origin}/img/main.jpg?imwidth=1260`)
    expect(urls).toContain(`${location.origin}/img/main.jpg?imwidth=2160`)
    expect(urls).toContain(`${location.origin}/img/alt.webp?imwidth=800`)
    expect(urls.every((u) => u.startsWith('http'))).toBe(true)
  })

  it('reports the decoded dimensions, not the rendition width', () => {
    document.body.innerHTML = '<img src="/p.jpg?imwidth=1536">'
    const img = document.querySelector('img')!
    // What a desktop browser actually reports for H&M's 1536 rendition.
    setDecoded(img, 595, 893)

    const [entry] = collect(document, window).images
    expect(entry).toMatchObject({ w: 595, h: 893 })
  })

  it('flags only images meaningfully on screen', () => {
    document.body.innerHTML = '<img id="a" src="/a.jpg"><img id="b" src="/b.jpg">'
    const onscreen = document.getElementById('a')!
    const offscreen = document.getElementById('b')!
    setRect(onscreen, { top: 40, bottom: 640, width: 400, height: 600 })
    setRect(offscreen, { top: 4000, bottom: 4600, width: 400, height: 600 })

    const byUrl = new Map(collect(document, window).images.map((i) => [i.url, i]))
    expect(byUrl.get(`${location.origin}/a.jpg`)?.inViewport).toBe(true)
    expect(byUrl.get(`${location.origin}/b.jpg`)?.inViewport).toBe(false)
  })

  it('keeps the stronger visibility when one URL is reached twice', () => {
    // src and srcset resolving to the same URL must not downgrade inViewport.
    document.body.innerHTML = '<img src="/same.jpg" srcset="/same.jpg 100w">'
    setRect(document.querySelector('img')!, { top: 0, bottom: 600, width: 400, height: 600 })

    const images = collect(document, window).images
    expect(images).toHaveLength(1)
    expect(images[0]!.inViewport).toBe(true)
  })

  it('collects JSON-LD and og:image, and a malformed block costs only itself', () => {
    document.head.innerHTML = `
      <meta property="og:image" content="/og.jpg?imwidth=657">
      <script type="application/ld+json">{ "@type": "Product", "name": "Skjorte" }</script>
      <script type="application/ld+json">{ not json at all </script>
      <script type="application/ld+json">{ "@type": "BreadcrumbList" }</script>
    `
    const harvest = collect(document, window)

    expect(harvest.og).toEqual([`${location.origin}/og.jpg?imwidth=657`])
    expect(harvest.jsonld).toHaveLength(2)
    expect(harvest.jsonld[0]).toMatchObject({ name: 'Skjorte' })
  })

  it('carries the page URL and title', () => {
    document.title = 'Skjorte - Rød - DAME | H&M DK'
    const harvest = collect(document, window)
    expect(harvest.pageUrl).toBe(location.href)
    expect(harvest.title).toBe('Skjorte - Rød - DAME | H&M DK')
  })
})
