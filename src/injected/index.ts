/**
 * Entry point for the bundle injected into the retailer page.
 *
 * Injected with `scripting.executeScript({ files: ['injected.js'] })`, which runs
 * it in the extension's isolated world — same DOM, no access to the page's JS
 * globals, and no CORS involved because nothing here fetches anything.
 *
 * ## Nothing is collected until the user asks
 *
 * This used to harvest on command from the background, immediately, advancing the
 * carousel by itself. It now *arms*: it clears the cookie wall, puts a viewfinder
 * on the page, and waits. `collect` runs on the button press and not before, so
 * what reaches the studio is the page the user actually chose to show us, framed
 * on the photograph they actually want.
 *
 * The consequence for the background is that `harvest` stops being a few-second
 * call and starts waiting on a human — see `router.ts` for how that is bounded.
 */

import type { RawHarvest } from '../protocol'
import { MARKER } from '../protocol'
import { collect } from './collect'
import { dismissConsent } from './consent'
import {
  cutoutRect,
  framedImage,
  framedUrls,
  markFramed,
  mountFrameOverlay,
  type FrameOverlay,
} from './frame'

/** Time for a dismissed cookie wall to unmount and the page to lay out. */
const CONSENT_SETTLE_MS = 400

export interface GrabResult extends RawHarvest {
  /** Diagnostics, logged by the background. The page ignores them, but "41
   *  images, nothing framed" is the difference between a fixable report and a
   *  shrug. */
  meta: {
    version: number
    consentDismissed: boolean
    /** Did the user have an image inside the cutout at all? */
    framed: boolean
    /** How many harvest entries the framed element accounted for. Zero with
     *  `framed: true` means the viewfinder found an `<img>` that `collect` did
     *  not record — a real bug, and invisible without this. */
    framedMatches: number
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface Messaging {
  runtime?: { sendMessage?: (msg: unknown) => unknown }
}

/** Firefox first, as everywhere else in this extension. Absent under test. */
function send(msg: unknown): void {
  const g = globalThis as unknown as { browser?: Messaging; chrome?: Messaging }
  const runtime = g.browser?.runtime?.sendMessage ? g.browser.runtime : g.chrome?.runtime
  try {
    // The background answers `{ ok: true }` and we have nothing to do with it;
    // an unhandled rejection here would surface in the retailer's console.
    void Promise.resolve(runtime?.sendMessage?.(msg)).catch(() => {})
  } catch {
    /* the page outlived the extension context */
  }
}

/**
 * Whether a cookie wall was cleared at any point in this session.
 *
 * Spans arming and grabbing on purpose. Reporting only the grab-time check would
 * say `false` on every site where arming already dealt with the wall — which is
 * most of them — and that is precisely the diagnostic being asked for.
 */
let consentSeen = false

/** Read the page as it stands, flagging whatever sits in the viewfinder. */
export function grab(): GrabResult {
  // Consent walls can also appear late — on scroll, or on a soft navigation.
  if (dismissConsent(document)) consentSeen = true

  const harvest = collect(document, window)
  const img = framedImage(document, cutoutRect(window))
  const framedMatches = img ? markFramed(harvest, framedUrls(img, harvest.pageUrl)) : 0

  return {
    ...harvest,
    meta: { version: 2, consentDismissed: consentSeen, framed: !!img, framedMatches },
  }
}

let overlay: FrameOverlay | null = null

async function arm(sessionId: string): Promise<void> {
  // Rejecting a cookie wall is not collecting photos, and it never accepts. It
  // happens up front because a consent wall the user has to dismiss by hand is
  // a wall between them and the photo they came to frame.
  if (dismissConsent(document)) {
    consentSeen = true
    await delay(CONSENT_SETTLE_MS)
  }

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

// Idempotent: the background may inject twice if a session is retried in the
// same tab, and re-running the module must not drop a live overlay.
if (!g.__dripdHarvest) g.__dripdHarvest = { arm, grab }
