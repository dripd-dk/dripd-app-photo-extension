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

export type Kind = 'ping' | 'harvest' | 'fetchBytes' | 'resolve'
export type ResolveAction = 'dismiss' | 'surface'

export interface RawImage {
  url: string
  w: number
  h: number
  inViewport?: boolean
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

export type Req = PingReq | HarvestReq | FetchBytesReq | ResolveReq

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
