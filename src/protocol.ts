/**
 * The wire contract between `dripd-app` and this extension.
 *
 * The page side is `dripd-app/app/composables/useCaptureBridge.ts`. Keep the two
 * in step: it is the only file over there that knows this extension exists.
 *
 * ## `dir` is load-bearing
 *
 * `window.postMessage` on the current window delivers the event to *that same
 * window's* `message` listeners, so a request is echoed straight back into the
 * listener awaiting its reply. Without a direction discriminator that echo
 * matches on `__dripd` + `nonce`, carries no `ok`, and rejects the request about
 * 2 ms after it was sent — which is how the page side once shipped completely
 * non-functional with thirteen green unit tests.
 *
 * So: the page sends `dir: 'req'` and accepts only `dir: 'res'`; the bridge
 * relays only `dir: 'req'` and answers only with `dir: 'res'`.
 */

export const MARKER = '__dripd' as const

export type Kind = 'ping' | 'harvest' | 'fetchBytes' | 'resolve' | 'framed' | 'ready'
export type ResolveAction = 'dismiss' | 'surface'

export interface RawImage {
  url: string
  w: number
  h: number
  inViewport?: boolean
  /** This is the image the user put inside the cutout. Every URL belonging to
   *  that one `<img>` carries the flag, because `collect` records an element's
   *  `currentSrc`, `src` and best `srcset` rendition as separate entries and the
   *  server may rank any of them. The page uses it to float the user's own
   *  choice to the front of the picker. */
  framed?: boolean
}

export interface RawHarvest {
  pageUrl: string
  title: string | null
  jsonld: unknown[]
  og: string[]
  images: RawImage[]
}

export interface PingReq {
  kind: 'ping'
}
export interface HarvestReq {
  kind: 'harvest'
  url: string
}
export interface FetchBytesReq {
  kind: 'fetchBytes'
  sessionId: string
  url: string
}
export interface ResolveReq {
  kind: 'resolve'
  sessionId: string
  action: ResolveAction
}
/**
 * Sent by the injected overlay — not by the page — when the user presses "Hent
 * billeder" or cancels. It is what makes `harvest` resolve, so it travels the
 * same `runtime.sendMessage` path as everything else and carries its session id
 * rather than relying on the sender's tab.
 */
export interface FramedReq {
  kind: 'framed'
  sessionId: string
  harvest?: RawHarvest
  cancelled?: boolean
}

/**
 * Sent by the injected bundle the moment it loads, before it does anything.
 *
 * The bundle is registered for the retailer's ORIGIN, so it also runs in any
 * other tab the user has open on that shop — it cannot know from the page alone
 * whether it is the capture. It asks, and the background answers from the tab
 * the message came in on. A tab that is not a capture takes its cover down and
 * does nothing else.
 *
 * This is the one message whose meaning depends on its sender's tab rather than
 * on its contents, for the simple reason that its whole question is "which tab
 * am I".
 */
export interface ReadyReq {
  kind: 'ready'
}

export type Req = PingReq | HarvestReq | FetchBytesReq | ResolveReq | FramedReq | ReadyReq

export type Reply =
  | { ok: true; [k: string]: unknown }
  | { ok: false; error: string }

/** Every failure the page can see, as a stable string. The studio maps these to
 *  Danish copy, so renaming one is a breaking change. */
export const ERR = {
  badUrl: 'bad_url',
  needsPermission: 'needs_permission',
  noSession: 'no_session',
  openFailed: 'open_failed',
  injectFailed: 'inject_failed',
  fetchFailed: 'fetch_failed',
  tooLarge: 'too_large',
  unknownKind: 'unknown_kind',
  /** The user closed the popup, or pressed Annullér, before framing anything. */
  windowClosed: 'window_closed',
  /** Nobody pressed the button. Not a failure of the extension, and the copy
   *  must not read like one. */
  frameTimeout: 'frame_timeout',
} as const

/** Only https, and only a real absolute URL. The background never fetches or
 *  opens anything that has not been through here. */
export function safeHttpsUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || !raw) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  return u.protocol === 'https:' ? u : null
}
