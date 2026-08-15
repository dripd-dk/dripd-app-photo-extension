/**
 * The framing overlay: a viewfinder the user lines the product photo up inside,
 * and the button that collects when *they* say so.
 *
 * ## Why a cutout and not a list
 *
 * The old flow harvested the moment the page settled, advanced the carousel by
 * itself, and handed the studio everything it could find. That is a guess dressed
 * up as automation: on a page whose thumbnail strip and related-products rail are
 * indistinguishable to any generic selector, the user's actual garment is one tile
 * among thirty. Framing inverts it — the person who knows which photograph they
 * want says so, in the one gesture every phone camera has already taught them.
 *
 * It also removes the failure mode we could never fix from here. A carousel that
 * ignores every generic handle used to silently yield the fresh-load subset; now
 * the user just scrolls to the photo and frames it.
 *
 * ## Constraints this file works under
 *
 * - **The page must stay usable.** Everything is `pointer-events: none` except the
 *   button bar, so scrolling, clicking a thumbnail and dragging a carousel all
 *   still reach the retailer's own page underneath.
 * - **Retailer CSS must not reach us.** The overlay lives in a shadow root with an
 *   `all: initial` reset — a site with `div { display: none !important }` in some
 *   print stylesheet cannot blank the viewfinder.
 * - **We must not pollute the harvest.** No `<img>` anywhere in here, and shadow
 *   content is invisible to `document.querySelectorAll('img')` regardless, so
 *   `collect` cannot mistake our own chrome for a product photo.
 */

import { bestFromSrcset } from './collect'
import type { RawHarvest } from '../protocol'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The cutout is a scaled-down copy of the window, so it always carries the
 * window's own aspect ratio.
 *
 * It started portrait, on the reasoning that garment photography is. That is a
 * phone's logic: this runs in a desktop popup, where a 3:4 frame wastes most of a
 * landscape window and makes the user hunt for a narrow strip. Matching the window
 * means the frame is simply "most of what you can see", which is what a desktop
 * user is aiming with.
 */
const MAX_WIDTH_FRACTION = 0.96
/** Never collapse to nothing on a very short window. */
const MIN_SCALE = 0.3
/** Vertical room reserved for the button bar, so the cutout never sits under it. */
const BAR_RESERVE = 108
/**
 * Room above the cutout for the hint pill.
 *
 * Must cover the pill's own height plus a margin, not just the gap: at 56 the
 * two-line pill landed at y=8 on a 720px viewport, flush with the top edge and
 * behind the retailer's sticky header. The cutout gives up vertical centring for
 * this — an off-centre frame is fine, an unreadable instruction is not.
 */
export const HINT_RESERVE = 84
/** Gap between the pill's top and the cutout's, so `HINT_RESERVE - HINT_OFFSET`
 *  is the margin left above the pill. */
const HINT_OFFSET = 60

export const HOST_ID = '__dripd_frame'

/**
 * Where the viewfinder sits, in viewport coordinates.
 *
 * Deliberately a pure function of the viewport: the click handler recomputes it
 * rather than reading the DOM, so what gets framed is what the geometry says, not
 * whatever a mid-resize layout happens to report.
 */
export function cutoutRect(win: Window = window): Rect {
  const vw = win.innerWidth || 0
  const vh = win.innerHeight || 0
  if (vw <= 0 || vh <= 0) return { left: 0, top: 0, width: 0, height: 0 }

  // One scale factor applied to both axes is what keeps the cutout's aspect
  // identical to the window's — derive either dimension independently and it
  // stops being a copy of the window the moment the reserves bite.
  const scale = Math.max(
    MIN_SCALE,
    Math.min(MAX_WIDTH_FRACTION, (vh - HINT_RESERVE - BAR_RESERVE) / vh),
  )
  const width = vw * scale
  const height = vh * scale

  return {
    left: Math.max(0, (vw - width) / 2),
    top: Math.max(HINT_RESERVE, (vh - BAR_RESERVE - height) / 2),
    width,
    height,
  }
}

function overlapArea(a: DOMRect, b: Rect): number {
  const w = Math.min(a.right, b.left + b.width) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.top + b.height) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * The image the user framed.
 *
 * Most overlap wins, ties broken by decoded resolution. The sliver rule is what
 * stops a neighbouring tile that clips one corner of the viewfinder from
 * outranking the photo filling it: a candidate must either cover a real share of
 * the cutout or sit mostly inside it. A 116px thumbnail centred in the frame
 * passes on the second clause, which matters because on H&M a thumbnail is an
 * upgradeable pointer to a 2160px original, not a dead end.
 */
export function framedImage(
  doc: Document = document,
  rect: Rect = cutoutRect(),
): HTMLImageElement | null {
  const cutoutArea = rect.width * rect.height
  if (cutoutArea <= 0) return null

  let best: HTMLImageElement | null = null
  let bestOverlap = 0
  let bestPixels = -1

  for (const img of doc.querySelectorAll('img')) {
    let box: DOMRect
    try {
      box = img.getBoundingClientRect()
    } catch {
      continue
    }
    if (!box || box.width <= 0 || box.height <= 0) continue

    const overlap = overlapArea(box, rect)
    if (overlap <= 0) continue
    const ownArea = box.width * box.height
    if (overlap < Math.min(cutoutArea * 0.08, ownArea * 0.5)) continue

    const pixels = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0)
    if (overlap > bestOverlap || (overlap === bestOverlap && pixels > bestPixels)) {
      best = img
      bestOverlap = overlap
      bestPixels = pixels
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

/**
 * Every URL `collect` would have recorded for this one element.
 *
 * Must mirror `collect`'s push order exactly — `currentSrc`, the `src` attribute,
 * then the widest `srcset` rendition — or the flag lands on nothing and the user's
 * choice silently stops being honoured.
 */
export function framedUrls(img: HTMLImageElement, base: string): string[] {
  const out: string[] = []
  const add = (raw: string | null | undefined) => {
    const abs = absolute(raw, base)
    if (abs && !out.includes(abs)) out.push(abs)
  }
  add(img.currentSrc)
  if (img.getAttribute('src')) add(img.src)
  const srcset = img.getAttribute('srcset')
  if (srcset) add(bestFromSrcset(srcset))
  return out
}

/** Flag the framed element's URLs in a harvest. Returns how many entries matched
 *  — zero means the user framed something `collect` never recorded, which is a
 *  diagnostic worth having in the log. */
export function markFramed(harvest: RawHarvest, urls: string[]): number {
  if (urls.length === 0) return 0
  let n = 0
  for (const record of harvest.images) {
    if (urls.includes(record.url)) {
      record.framed = true
      n++
    }
  }
  return n
}

export type FrameState = 'idle' | 'busy' | 'sent'

export interface FrameOverlay {
  setState(state: FrameState): void
  destroy(): void
}

export interface FrameStrings {
  title: string
  body: string
  grab: string
  busy: string
  again: string
  cancel: string
}

export const DEFAULT_STRINGS: FrameStrings = {
  title: 'Flyt siden, så billedet er i rammen',
  body: 'Tryk derefter på “Hent billeder”.',
  grab: 'Hent billeder',
  busy: 'Henter…',
  again: 'Hent igen',
  cancel: 'Annullér',
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  position: absolute;
  inset: 0;
  font: 400 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
/* One element paints the whole scrim: an enormous spread shadow covers the
   viewport and the element's own box is the hole. Cheaper and crisper than four
   divs, and the rounded corners come free. */
.cutout {
  position: absolute;
  border-radius: 18px;
  box-shadow: 0 0 0 100vmax rgba(20, 19, 17, 0.2);
  outline: 2px solid rgba(255, 255, 255, 0.92);
  outline-offset: -1px;
  transition: opacity 160ms ease;
}
.tick {
  position: absolute;
  width: 26px;
  height: 26px;
  border: 3px solid #34d399;
}
.tick.tl { top: -3px; left: -3px; border-right: 0; border-bottom: 0; border-radius: 18px 0 0 0; }
.tick.tr { top: -3px; right: -3px; border-left: 0; border-bottom: 0; border-radius: 0 18px 0 0; }
.tick.bl { bottom: -3px; left: -3px; border-right: 0; border-top: 0; border-radius: 0 0 0 18px; }
.tick.br { bottom: -3px; right: -3px; border-left: 0; border-top: 0; border-radius: 0 0 18px 0; }
.hint {
  position: absolute;
  transform: translateX(-50%);
  max-width: min(92vw, 30rem);
  padding: 10px 16px;
  border-radius: 999px;
  background: rgba(20, 19, 17, 0.88);
  color: #fff;
  text-align: center;
}
.hint b { display: block; font-weight: 600; font-size: 14px; }
.hint span { display: block; font-size: 12px; color: rgba(255, 255, 255, 0.72); }
.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 22px;
  pointer-events: auto;
}
button {
  font: inherit;
  font-weight: 600;
  font-size: 15px;
  padding: 13px 30px;
  border: 0;
  border-radius: 999px;
  background: #059669;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}
button:disabled { background: #6b7d75; cursor: default; }
.cancel {
  background: none;
  box-shadow: none;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.78);
  text-decoration: underline;
}
.cancel:disabled { background: none; color: rgba(255, 255, 255, 0.4); }
`

export interface FrameOverlayOpts {
  onGrab(): void
  onCancel(): void
  doc?: Document
  win?: Window
  strings?: Partial<FrameStrings>
}

/**
 * Mount the overlay. Idempotent by host id, because the background may inject
 * twice when a session is retried in the same tab and two viewfinders stacked on
 * each other would double the scrim.
 */
export function mountFrameOverlay(opts: FrameOverlayOpts): FrameOverlay {
  const doc = opts.doc ?? document
  const win = opts.win ?? window
  const s: FrameStrings = { ...DEFAULT_STRINGS, ...opts.strings }

  doc.getElementById(HOST_ID)?.remove()

  const host = doc.createElement('div')
  host.id = HOST_ID
  host.setAttribute(
    'style',
    'position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;',
  )
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="wrap">
      <div class="cutout" part="cutout">
        <i class="tick tl"></i><i class="tick tr"></i>
        <i class="tick bl"></i><i class="tick br"></i>
      </div>
      <div class="hint"><b></b><span></span></div>
      <div class="bar">
        <button type="button" data-dripd="grab"></button>
        <button type="button" class="cancel" data-dripd="cancel"></button>
      </div>
    </div>`

  const cutout = root.querySelector<HTMLElement>('.cutout')!
  const hint = root.querySelector<HTMLElement>('.hint')!
  const grabBtn = root.querySelector<HTMLButtonElement>('[data-dripd="grab"]')!
  const cancelBtn = root.querySelector<HTMLButtonElement>('[data-dripd="cancel"]')!

  hint.querySelector('b')!.textContent = s.title
  hint.querySelector('span')!.textContent = s.body
  grabBtn.textContent = s.grab
  cancelBtn.textContent = s.cancel

  function layout(): void {
    const r = cutoutRect(win)
    cutout.style.left = `${r.left}px`
    cutout.style.top = `${r.top}px`
    cutout.style.width = `${r.width}px`
    cutout.style.height = `${r.height}px`
    hint.style.left = `${r.left + r.width / 2}px`
    hint.style.top = `${Math.max(8, r.top - HINT_OFFSET)}px`
  }

  let frame: number | null = null
  const onResize = () => {
    if (frame !== null) return
    const raf = win.requestAnimationFrame ?? ((fn: FrameRequestCallback) => win.setTimeout(fn, 16))
    frame = raf(() => {
      frame = null
      layout()
    }) as unknown as number
  }

  grabBtn.addEventListener('click', () => opts.onGrab())
  cancelBtn.addEventListener('click', () => opts.onCancel())
  win.addEventListener('resize', onResize)
  win.addEventListener('orientationchange', onResize)

  layout()
  // documentElement, not body: a site whose body is re-rendered by its own
  // framework would take the overlay with it.
  doc.documentElement.appendChild(host)

  return {
    setState(state) {
      grabBtn.disabled = state === 'busy'
      cancelBtn.disabled = state === 'busy'
      grabBtn.textContent = state === 'busy' ? s.busy : state === 'sent' ? s.again : s.grab
      cutout.style.opacity = state === 'idle' ? '1' : '0.45'
    },
    destroy() {
      win.removeEventListener('resize', onResize)
      win.removeEventListener('orientationchange', onResize)
      host.remove()
    },
  }
}
