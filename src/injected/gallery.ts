/**
 * Reach the photos a product gallery has not loaded yet.
 *
 * ## Why this exists
 *
 * Measured on a real H&M PDP in a warm consumer Chrome, 2026-08-14:
 *
 * | DOM state | gallery photos | 116px thumbs | unrelated product cards |
 * |---|---|---|---|
 * | fresh load | 3 | 2 | 0 |
 * | after browsing the carousel | 6 | 1 | 9 |
 * | after a full-page scroll | 3 — unchanged | 2 | 9 |
 *
 * The gallery is a Splide carousel whose slides load on **interaction**. So
 * scrolling — what the mobile flow does — gains exactly zero gallery photos here,
 * while dragging in nine related-product cards that are indistinguishable from
 * product photos by size or URL. Hence: never scroll, advance instead.
 *
 * ## Rules this obeys
 *
 * - **Generic handles only.** No per-retailer selector map: shipping one means a
 *   store review every time a retailer renames a class, which was the original
 *   objection to doing any of this in the extension.
 * - **Union, never replace.** Each advance's harvest merges into the running set
 *   keyed by URL, so a carousel that half-works still beats not trying, and a
 *   slide that unmounts on advance does not take its photo with it.
 * - **Bounded.** Eight advances or four seconds, whichever comes first, then
 *   return whatever exists. An unresponsive carousel degrades to the fresh-load
 *   result; it must never hang, because a hang is a 45 s bridge timeout and a
 *   dead studio.
 * - **Never navigate.** Anchors are deliberately excluded as advance handles: a
 *   thumbnail strip and a related-products rail look alike, and clicking the
 *   wrong one would silently capture a different product. Losing one strategy is
 *   cheaper than capturing the wrong garment.
 * - **Never scroll.** No `scrollIntoView`, no `scrollTo` — see the table.
 */

import type { RawHarvest, RawImage } from '../protocol'
import { collect as defaultCollect } from './collect'
import { normalizeKey } from './key'

/** Anything wider than this is a gallery image, not a thumbnail control. */
const MAX_THUMB_WIDTH = 320
/** Enough handles for any real gallery; a rail of 40 is not a thumbnail strip. */
const MAX_THUMB_HANDLES = 12
/** The server truncates to the first 600 images, so growing past it only wastes
 *  advances — the entries that would be dropped are the ones we just found. */
const MAX_IMAGES = 600

const NEXT_WORDS = /(next|næste|forward|højre|right)/i
const PREV_WORDS = /(prev|previous|forrige|back|venstre|left)/i

export interface GalleryDeps {
  doc?: Document
  win?: Window
  collect?: (doc: Document, win: Window) => RawHarvest
  maxAdvances?: number
  budgetMs?: number
  settleMs?: number
  now?: () => number
  wait?: (ms: number) => Promise<void>
}

export interface GalleryResult {
  harvest: RawHarvest
  /** How many advance actions were performed. */
  advances: number
  /** Which strategies actually produced a new asset, in order of use. */
  strategies: string[]
  /** Distinct assets found beyond the first harvest. */
  gained: number
}

interface Step {
  strategy: string
  run: () => void
}

function isVisible(el: Element): boolean {
  try {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  } catch {
    return false
  }
}

/**
 * Would clicking this navigate away?
 *
 * Excluding anchors from the handle search is not enough on its own: a click on an
 * `<img>` inside an `<a href>` bubbles to the anchor and follows it. The popup
 * would then be showing a *different product*, and the harvest would quietly
 * capture the wrong garment — far worse than missing a photo. So anything under a
 * link is out.
 */
function underLink(el: Element): boolean {
  return !!el.closest('a[href]')
}

function labelOf(el: Element): string {
  return [
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.getAttribute('data-testid'),
    el.getAttribute('class'),
  ]
    .filter(Boolean)
    .join(' ')
}

/** The main image: the one the page itself calls the product photo. */
export function findHero(doc: Document, ogUrls: string[]): HTMLImageElement | null {
  const imgs = Array.from(doc.querySelectorAll('img'))

  if (ogUrls.length) {
    const keys = new Set(ogUrls.map(normalizeKey))
    for (const img of imgs) {
      const src = img.currentSrc || img.getAttribute('src')
      if (src && keys.has(normalizeKey(new URL(src, doc.location?.href || '').href))) return img
    }
  }

  let best: HTMLImageElement | null = null
  let bestArea = 0
  for (const img of imgs) {
    const area = (img.naturalWidth || 0) * (img.naturalHeight || 0)
    if (area > bestArea) {
      bestArea = area
      best = img
    }
  }
  return best
}

/** Nearest ancestor holding at least `minImages` images — the carousel, rather
 *  than the whole page. Nearest, not outermost, so a related-products rail
 *  further up the tree never joins the scope. */
export function ancestorWithImages(
  el: Element,
  minImages: number,
  maxLevels: number,
): Element | null {
  let cur = el.parentElement
  let level = 0
  while (cur && level < maxLevels) {
    if (cur.querySelectorAll('img').length >= minImages) return cur
    cur = cur.parentElement
    level += 1
  }
  return null
}

/** Clickable thumbnails inside the gallery scope. Anything under a link is
 *  excluded on purpose — see `underLink`. */
export function thumbnailSteps(scope: Element, hero: Element | null): Step[] {
  const steps: Step[] = []
  const seen = new Set<Element>()

  for (const img of scope.querySelectorAll('img')) {
    if (img === hero) continue
    if (underLink(img)) continue
    let width = 0
    try {
      width = Math.max(img.getBoundingClientRect().width, img.naturalWidth || 0)
    } catch {
      width = img.naturalWidth || 0
    }
    if (width <= 0 || width > MAX_THUMB_WIDTH) continue

    const handle =
      (img.closest('button,[role="button"],[role="tab"],li,label') as HTMLElement | null) ?? img
    if (seen.has(handle)) continue
    seen.add(handle)
    steps.push({ strategy: 'thumbnail', run: () => handle.click() })
    if (steps.length >= MAX_THUMB_HANDLES) break
  }

  return steps
}

/** A "next" control, re-found on every use because carousels replace theirs. */
export function findNextButton(scope: Element, doc: Document): HTMLElement | null {
  const roots: Element[] = [scope]
  if (doc.body && doc.body !== scope) roots.push(doc.body)

  for (const root of roots) {
    const candidates = root.querySelectorAll<HTMLElement>(
      'button,[role="button"],[class*="arrow"],[class*="next"],[class*="Next"]',
    )
    for (const el of candidates) {
      const label = labelOf(el)
      if (!NEXT_WORDS.test(label)) continue
      if (PREV_WORDS.test(label)) continue
      if ((el as HTMLButtonElement).disabled) continue
      if (underLink(el)) continue
      if (!isVisible(el)) continue
      return el
    }
  }
  return null
}

export async function harvestGallery(deps: GalleryDeps = {}): Promise<GalleryResult> {
  const doc = deps.doc ?? document
  const win = deps.win ?? window
  const collect = deps.collect ?? defaultCollect
  const maxAdvances = deps.maxAdvances ?? 8
  const budgetMs = deps.budgetMs ?? 4_000
  const settleMs = deps.settleMs ?? 250
  const now = deps.now ?? (() => Date.now())
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => win.setTimeout(r, ms)))

  const started = now()
  const base = collect(doc, win)

  const byUrl = new Map<string, RawImage>()
  const assets = new Set<string>()
  const og: string[] = []
  let jsonld: unknown[] = []
  let title = base.title

  /** Merge a harvest in; report how many previously unseen ASSETS it added.
   *  Asset-level, not URL-level: another rendition of a photo we already have is
   *  not progress, and the bound should not be spent on it. */
  function absorb(h: RawHarvest): number {
    let fresh = 0
    for (const img of h.images) {
      const prev = byUrl.get(img.url)
      if (prev) {
        if (img.inViewport) prev.inViewport = true
        continue
      }
      if (byUrl.size >= MAX_IMAGES) break
      byUrl.set(img.url, { ...img })
      const key = normalizeKey(img.url)
      if (!assets.has(key)) {
        assets.add(key)
        fresh += 1
      }
    }
    for (const url of h.og) if (!og.includes(url)) og.push(url)
    // A page still hydrating can yield a thinner JSON-LD block on the first pass.
    if (h.jsonld.length > jsonld.length) jsonld = h.jsonld
    if (h.title) title = h.title
    return fresh
  }

  absorb(base)
  const baseline = assets.size

  const hero = findHero(doc, base.og)
  const track = hero ? ancestorWithImages(hero, 2, 6) ?? hero.parentElement : null
  const scope = hero ? ancestorWithImages(hero, 4, 10) ?? track : null

  const strategies: string[] = []
  let advances = 0

  if (scope) {
    const plans: Step[][] = [
      thumbnailSteps(scope, hero),
      // Re-find the arrow each round: Splide and friends swap theirs on advance.
      Array.from({ length: maxAdvances }, () => ({
        strategy: 'next-button',
        run: () => findNextButton(scope, doc)?.click(),
      })),
      Array.from({ length: maxAdvances }, () => ({
        strategy: 'arrow-key',
        run: () => {
          const target = (track ?? doc.body) as HTMLElement
          try {
            target.focus?.()
          } catch {
            /* not focusable, still dispatch */
          }
          // The global constructor, not `win.KeyboardEvent`: in the isolated world
          // the global IS the page's realm, and it is the one a listener there
          // recognises.
          target.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'ArrowRight',
              code: 'ArrowRight',
              bubbles: true,
              cancelable: true,
            }),
          )
        },
      })),
    ]

    outer: for (const plan of plans) {
      let barren = 0
      for (const step of plan) {
        if (advances >= maxAdvances) break outer
        if (now() - started >= budgetMs) break outer

        advances += 1
        try {
          step.run()
        } catch {
          /* a handle that throws is just a handle that did not work */
        }
        await wait(settleMs)

        const fresh = absorb(collect(doc, win))
        if (fresh > 0) {
          if (!strategies.includes(step.strategy)) strategies.push(step.strategy)
          barren = 0
        } else if (++barren >= 2) {
          // Two dead advances in a row: this strategy does not drive this gallery.
          break
        }
      }
    }
  }

  return {
    harvest: {
      pageUrl: base.pageUrl,
      title,
      jsonld,
      og,
      images: Array.from(byUrl.values()),
    },
    advances,
    strategies,
    gained: assets.size - baseline,
  }
}
