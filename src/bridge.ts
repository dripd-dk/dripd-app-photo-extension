/**
 * The dripd-page ↔ background relay, and the extension's security boundary.
 *
 * Functionally this extension is a CORS-bypass proxy that fetches with the user's
 * cookies. The `content_scripts.matches` list is the only thing stopping any
 * website from driving it, so treat everything here as load-bearing rather than
 * configuration:
 *
 * - `matches` is dripd's origin only. No `http:`, no wildcard subdomains.
 * - `event.source === win` rejects an iframe embedded in a dripd page.
 * - `event.origin === location.origin` rejects a cross-origin poster.
 * - Only `dir: 'req'` is relayed, and replies are only ever `dir: 'res'`. Without
 *   that split this listener would receive its own replies and relay them back to
 *   the background in a loop — and on the page side the same echo made every
 *   request reject itself milliseconds after being sent.
 *
 * Separated from `bridge.content.ts` so the checks can be tested against a real
 * `window`. That matters more than it sounds: a hand-rolled fake window that does
 * not echo `postMessage` back to its own listeners is exactly what hid the `dir`
 * bug through thirteen green tests.
 */

import { MARKER } from './protocol'

export interface BridgeDeps {
  win: Window
  /** Send to the background and resolve with its reply. */
  send: (msg: unknown) => Promise<unknown>
  version?: string
}

export function installBridge(deps: BridgeDeps): () => void {
  const { win, send } = deps

  const onMessage = (event: MessageEvent) => {
    if (event.source !== win) return
    if (event.origin !== win.location.origin) return

    const msg = event.data as Record<string, unknown> | null
    if (!msg || msg[MARKER] !== true || msg.dir !== 'req') return

    const nonce = msg.nonce
    const reply = (payload: Record<string, unknown>) => {
      win.postMessage({ [MARKER]: true, dir: 'res', nonce, ...payload }, win.location.origin)
    }

    send(msg).then(
      (result) => {
        // A listener that never answered gives `undefined`; report it rather than
        // leaving the page to time out 45 s later.
        if (!result || typeof result !== 'object') {
          reply({ ok: false, error: 'no_reply' })
          return
        }
        reply(result as Record<string, unknown>)
      },
      (err: unknown) => reply({ ok: false, error: String((err as Error)?.message ?? err) }),
    )
  }

  win.addEventListener('message', onMessage)
  return () => win.removeEventListener('message', onMessage)
}

/** Announce presence, so a page loaded before the extension was installed can
 *  discover it on the next load. Carries no nonce, so it settles nothing — the
 *  page's own `ping` is the authoritative check. */
export function announce(win: Window, version: string): void {
  win.postMessage(
    { [MARKER]: true, dir: 'res', kind: 'ready', version },
    win.location.origin,
  )
}
