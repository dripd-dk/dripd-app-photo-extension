/**
 * Entry point for the bundle that runs on the retailer page.
 *
 * Registered by the background with `scripting.registerContentScripts` at
 * `run_at: document_start`, for the target origin, for the life of one capture.
 * It runs in the extension's isolated world — same DOM, no access to the page's
 * JS globals, and no CORS involved because nothing here fetches anything.
 *
 * ## It drives itself
 *
 * It used to be inert: the background injected it and then armed it with a
 * second `executeScript` carrying the session id. Both of those calls raced the
 * page's own navigations and neither could run before the retailer had painted,
 * which is what made the cover useless and made a redirect or a reload lose the
 * viewfinder for good.
 *
 * At `document_start` there is no race left to lose. On load it covers the
 * document, asks the background whether this tab is a capture, and then either
 * stands down or arms itself. Every document on the origin does this — including
 * the ones a redirect or a reload produces — so a navigation stops being a
 * failure and becomes another document that arms itself.
 *
 * ## Nothing is collected until the user asks
 *
 * Arming puts a viewfinder on the page and waits. `collect` runs on the button
 * press and not before, so what reaches the studio is the page the user actually
 * chose to show us, framed on the photograph they actually want.
 *
 * The consequence for the background is that `harvest` stops being a few-second
 * call and starts waiting on a human — see `router.ts` for how that is bounded.
 */

import type { RawHarvest } from '../protocol'
import { MARKER } from '../protocol'
import { collect } from './collect'
import { installCover, removeCover } from './cover'
import {
  cutoutRect,
  framedImage,
  framedUrls,
  markFramed,
  mountFrameOverlay,
  type FrameOverlay,
} from './frame'

export interface GrabResult extends RawHarvest {
  /** Diagnostics, logged by the background. The page ignores them, but "41
   *  images, nothing framed" is the difference between a fixable report and a
   *  shrug. */
  meta: {
    version: number
    /** Did the user have an image inside the cutout at all? */
    framed: boolean
    /** How many harvest entries the framed element accounted for. Zero with
     *  `framed: true` means the viewfinder found an `<img>` that `collect` did
     *  not record — a real bug, and invisible without this. */
    framedMatches: number
  }
}


interface Messaging {
  runtime?: { sendMessage?: (msg: unknown) => unknown }
}

/** Whichever namespace this browser has. Firefox first, as everywhere else. */
function messaging(): Messaging['runtime'] {
  const g = globalThis as unknown as { browser?: Messaging; chrome?: Messaging }
  return g.browser?.runtime?.sendMessage ? g.browser.runtime : g.chrome?.runtime
}

/**
 * Send and wait for the background's answer.
 *
 * Returns null on any failure, because every one of them means the same thing
 * here — nobody is going to tell us this is a capture, so stand down.
 */
function ask(msg: unknown): Promise<unknown> {
  try {
    return Promise.resolve(messaging()?.sendMessage?.(msg)).catch(() => null)
  } catch {
    return Promise.resolve(null)
  }
}

/** Firefox first, as everywhere else in this extension. Absent under test. */
function send(msg: unknown): void {
  try {
    // The background answers `{ ok: true }` and we have nothing to do with it;
    // an unhandled rejection here would surface in the retailer's console.
    void Promise.resolve(messaging()?.sendMessage?.(msg)).catch(() => {})
  } catch {
    /* the page outlived the extension context */
  }
}

/** Read the page as it stands, flagging whatever sits in the viewfinder. */
export function grab(): GrabResult {
  const harvest = collect(document, window)
  const img = framedImage(document, cutoutRect(window))
  const framedMatches = img ? markFramed(harvest, framedUrls(img, harvest.pageUrl)) : 0

  return {
    ...harvest,
    meta: { version: 3, framed: !!img, framedMatches },
  }
}

let overlay: FrameOverlay | null = null

/**
 * The extension does not touch a cookie wall.
 *
 * It used to click the reject button up front, wait 400 ms, then mount the
 * viewfinder. A real cookie wall reloads the page when either button is pressed,
 * and that reload raced the 400 ms timer: when it won, it took the just-mounted
 * overlay with it, and nothing re-arms — so the user got a shop page with no
 * viewfinder and no button, and the session hung to the frame timeout. The
 * second page load people saw was this click, not the retailer.
 *
 * The wall is the user's to dismiss. They are already standing in front of the
 * page to frame a photo, and the overlay is pointer-transparent everywhere but
 * its own button bar — so the wall is one click away for them and zero
 * navigations away for us.
 */
async function arm(sessionId: string): Promise<void> {
  overlay?.destroy()
  overlay = mountFrameOverlay({
    onGrab: () => {
      overlay?.setState('busy')
      let payload: GrabResult
      try {
        payload = grab()
      } catch {
        overlay?.setState('idle')
        return
      }
      send({ [MARKER]: true, kind: 'framed', sessionId, harvest: payload })
      // Stays mounted: if the studio finds nothing usable it surfaces this
      // window again, and the user's next move is to re-frame and press again.
      overlay?.setState('sent')
    },
    onCancel: () => {
      send({ [MARKER]: true, kind: 'framed', sessionId, cancelled: true })
      overlay?.destroy()
      overlay = null
    },
  })
}

interface InjectedGlobal {
  __dripdHarvest?: { arm: (sessionId: string) => Promise<void>; grab: () => GrabResult }
}

const g = globalThis as unknown as InjectedGlobal

// Kept for the bundle test and for anyone poking at a live page. Nothing in the
// extension calls it any more: the background no longer arms this script, the
// script arms itself.
if (!g.__dripdHarvest) g.__dripdHarvest = { arm, grab }

/** Resolve once there is a DOM to put a viewfinder on. At `document_start`
 *  there is not one yet, which is exactly why the cover goes up first. */
function documentReady(): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve()
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true })
  })
}

/**
 * What this script does on every document of the retailer's origin.
 *
 * The cover goes up first and unconditionally — before the handshake, before
 * anything is known — because it is the one thing that has to happen before the
 * document paints, and a message round trip is not something to paint behind.
 * On a tab that turns out not to be a capture it comes straight back down.
 */
async function begin(): Promise<void> {
  installCover(document)

  const reply = (await ask({ [MARKER]: true, kind: 'ready' })) as
    | { ok?: boolean; sessionId?: unknown }
    | null
  const sessionId = reply?.ok && typeof reply.sessionId === 'string' ? reply.sessionId : ''

  // Not our tab: the user is just browsing this shop while a capture runs
  // somewhere else, and they must not be left wearing a spinner.
  if (!sessionId) {
    removeCover(document)
    return
  }

  await documentReady()
  await arm(sessionId)
}

void begin()
