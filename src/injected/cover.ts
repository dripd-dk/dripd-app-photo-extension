/**
 * The cover the popup wears until the viewfinder is on the page.
 *
 * ## Why this is here and not in the background
 *
 * It used to be a self-contained function serialised into the page by
 * `router.ts` and injected on every `tabs.onUpdated`, racing the retailer's own
 * rendering. That race was not winnable:
 *
 * - Firefox **blocks** content-script execution in a moz-extension document, so
 *   every injection that arrived while the tab was still on our own loading page
 *   failed outright (`Content Script execution in moz-extension document has
 *   been deprecated and it has been blocked`).
 * - `tabs.update` does not change the tab's URL synchronously, so those early events
 *   kept arriving with the old URL current no matter where the listener was
 *   armed. Moving it was tried three times.
 * - The only injection that reliably landed was the one after the load wait and
 *   the settle, by which point the shop had been fully visible for the better
 *   part of a second — the exact thing the cover exists to prevent.
 *
 * Shipping it in the bundle and registering that bundle at `document_start`
 * replaces the race with a guarantee: the browser runs this before the document
 * has painted, on every document of the origin, including the ones a redirect or
 * a reload produces.
 */

export const LOADING_HOST_ID = '__dripd_loading'

/**
 * Nothing should ever leave an opaque panel over a page the user can still
 * click. Every path that ends a capture closes the window, and the handshake in
 * `index.ts` takes the cover down within a message round trip on any tab that is
 * not a capture at all — this is the valve for the case neither of those catches.
 */
const SELF_REMOVE_MS = 20_000

/** Kept identical to `src/loading.html`, which this takes over from when the
 *  retailer's document replaces our own. The handover is only invisible while
 *  the two match: same background, same ring, same words. Change both or
 *  neither. */
const CSS = `
:host { all: initial; }
.wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: #faf8f5;
  font: 600 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: #5c574e;
}
.ring {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid #eae6df;
  border-top-color: #059669;
  animation: dripd-spin 0.8s linear infinite;
}
@keyframes dripd-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ring { animation-duration: 2.4s; } }
`

export const COVER_TEXT = 'Gør rammen klar…'

/**
 * Put the cover up, once.
 *
 * Idempotent because the registered script runs on every document of the origin
 * and the same document can be re-entered; a second cover over the first would
 * be invisible but would leak a node and a timer.
 *
 * Built node by node rather than through `innerHTML`: nothing here is dynamic,
 * so the string form was safe, but it trips addons-linter's
 * UNSAFE_VAR_ASSIGNMENT and an extension whose pitch is "read the code" should
 * not make a reviewer pause over a parser call.
 */
export function installCover(doc: Document = document): void {
  if (doc.getElementById(LOADING_HOST_ID)) return
  // At `document_start` the parser has made the root element, but a document
  // that has not got that far yet must not throw — the next document on this
  // origin will run this again.
  const root = doc.documentElement
  if (!root) return

  const host = doc.createElement('div')
  host.id = LOADING_HOST_ID
  host.setAttribute(
    'style',
    'all:initial;position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;',
  )
  const shadow = host.attachShadow({ mode: 'open' })

  const style = doc.createElement('style')
  style.textContent = CSS
  const wrap = doc.createElement('div')
  wrap.className = 'wrap'
  const ring = doc.createElement('div')
  ring.className = 'ring'
  const text = doc.createElement('div')
  text.textContent = COVER_TEXT

  wrap.appendChild(ring)
  wrap.appendChild(text)
  shadow.appendChild(style)
  shadow.appendChild(wrap)
  root.appendChild(host)

  setTimeout(() => removeCover(doc), SELF_REMOVE_MS)
}

/** Take the cover down. Safe to call when there is none. */
export function removeCover(doc: Document = document): void {
  doc.getElementById(LOADING_HOST_ID)?.remove()
}
