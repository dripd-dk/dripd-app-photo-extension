/**
 * Read image URLs and product metadata out of a retailer page.
 *
 * Runs in the extension's isolated world, which shares the DOM but not the page's
 * JS globals. That is all we need: it only reads URLs and metadata. The bytes are
 * fetched afterwards by the background context, which is the only place a
 * cross-origin image CDN can be read at all — `image.hm.com` sends no
 * `Access-Control-Allow-Origin`, so a page-context `fetch` can never see it.
 *
 * Ported from `dripd-mobile`'s `harvestScript.ts`, where it is proven against a
 * real H&M page on a real device. Unlike that one this is a normal module, not a
 * stringified self-contained function, because the SW injects it with
 * `executeScript({ files })` — so it can be imported and unit-tested directly.
 */

import type { RawHarvest, RawImage } from '../protocol'

/** "On screen" means meaningfully visible, not a one-pixel sliver at the edge:
 *  a third of the element, or 100px, whichever is smaller. */
export function onScreen(el: Element, win: Window = window): boolean {
  try {
    const r = el.getBoundingClientRect()
    if (!r || r.height <= 0 || r.width <= 0) return false
    const vh = win.innerHeight || win.document.documentElement.clientHeight || 0
    const overlap = Math.min(r.bottom, vh) - Math.max(r.top, 0)
    if (overlap <= 0) return false
    return overlap >= Math.min(100, r.height * 0.34)
  } catch {
    return false
  }
}

export function bestFromSrcset(srcset: string): string | null {
  let best: string | null = null
  let bestW = -1
  for (const part of srcset.split(',')) {
    const bits = part.trim().split(/\s+/)
    const url = bits[0]
    const descriptor = bits[1]
    const w = descriptor && descriptor.endsWith('w') ? parseInt(descriptor, 10) : 0
    if (url && w >= bestW) {
      bestW = w
      best = url
    }
  }
  return best
}

function absolute(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null
  try {
    return new URL(raw, base).href
  } catch {
    return null
  }
}

export function collect(doc: Document = document, win: Window = window): RawHarvest {
  const base = doc.location?.href || win.location.href
  const images: RawImage[] = []
  const seen = new Map<string, RawImage>()

  function push(url: string | null | undefined, w: number, h: number, visible: boolean): void {
    const abs = absolute(url, base)
    if (!abs) return
    const existing = seen.get(abs)
    if (existing) {
      // Same URL reached twice (src and srcset): keep the stronger visibility.
      if (visible) existing.inViewport = true
      return
    }
    const record: RawImage = { url: abs, w: w || 0, h: h || 0, inViewport: visible }
    seen.set(abs, record)
    images.push(record)
  }

  for (const img of doc.querySelectorAll('img')) {
    // naturalWidth/Height are the DECODED dimensions — often a small srcset
    // rendition. The server sizes candidates by the URL's declared width and uses
    // these for the aspect ratio and the thumbnail floor.
    const w = img.naturalWidth || img.width || 0
    const h = img.naturalHeight || img.height || 0
    const visible = onScreen(img, win)
    if (img.currentSrc) push(img.currentSrc, w, h, visible)
    if (img.getAttribute('src')) push(img.src, w, h, visible)
    const srcset = img.getAttribute('srcset')
    if (srcset) push(bestFromSrcset(srcset), w, h, visible)
  }

  for (const source of doc.querySelectorAll('picture source[srcset]')) {
    const best = bestFromSrcset(source.getAttribute('srcset') || '')
    if (!best) continue
    const sibling = source.parentElement?.querySelector('img') ?? null
    push(
      best,
      sibling?.naturalWidth ?? 0,
      sibling?.naturalHeight ?? 0,
      sibling ? onScreen(sibling, win) : false,
    )
  }

  const jsonld: unknown[] = []
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      jsonld.push(JSON.parse(script.textContent || ''))
    } catch {
      /* a malformed block must not cost us the rest of the page */
    }
  }

  const og: string[] = []
  for (const meta of doc.querySelectorAll<HTMLMetaElement>(
    'meta[property="og:image"], meta[property="og:image:secure_url"]',
  )) {
    const abs = absolute(meta.content, base)
    if (abs) og.push(abs)
  }

  return {
    pageUrl: base,
    title: doc.title || null,
    jsonld,
    og,
    images,
  }
}
