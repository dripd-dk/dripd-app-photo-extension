/**
 * The background context: everything the extension actually does.
 *
 * Written as a factory over an injected browser API so the whole session
 * lifecycle is testable without a browser. The service worker (`sw.ts`) is the
 * eight-line wiring around it.
 *
 * ## Three verbs, and why `resolve` is not one of them
 *
 * | Verb | Meaning |
 * |---|---|
 * | `harvest(url)` | Open the popup, **wait for the user to frame a photo**, and leave it open |
 * | `fetchBytes(sessionId, url)` | Fetch in the background context; **extends the TTL** |
 * | `resolve(sessionId, action)` | **Window only:** close it, or bring it forward |
 *
 * `harvest` is the odd one: it does not resolve until a human presses a button in
 * the popup, so it can legitimately stay pending for minutes. Three things bound
 * it — a frame timeout, the tab being closed, and the Annullér button — and every
 * one of them rejects rather than hanging, because a hang upstream is a dead
 * studio with a spinner in it. The fourth verb, `framed`, is not part of the
 * page's vocabulary at all: the injected overlay sends it, and it exists only to
 * settle that promise.
 *
 * `resolve` closes the *window*; it does not end the *session*. The page ranks
 * the harvest server-side and resolves at that point — before the user has picked
 * an image — so a session that died on resolve would fail every subsequent
 * `fetchBytes` and no capture could ever complete. The byte fetch needs no window
 * at all; it happens here.
 *
 * A session therefore has its own 60 s TTL, extended by every `fetchBytes`. That
 * TTL is also the safety valve: on expiry any window still open is dismissed, so
 * a page crash or a mid-capture navigation cannot leak an orphaned popup, and no
 * cooperation from the page is required for that to hold.
 *
 * ## Why the popup is visible
 *
 * A background tab reports `document.visibilityState === 'hidden'`, and sites gate
 * image loading and carousels on it; `setTimeout` is clamped there, so the settle
 * choreography crawls; and viewport-proximity lazy loading frequently never fires,
 * leaving a harvest of one hero image. Hidden is also a plausible automation
 * signal, so it is arguably more suspicious rather than safer. A real, visible,
 * unfocused popup that closes itself is both more honest and more effective.
 */

import {
  ERR,
  safeHttpsUrl,
  type RawHarvest,
  type Reply,
  type Req,
  type ResolveAction,
} from './protocol'

const DEFAULT_TTL_MS = 60_000
const DEFAULT_LOAD_TIMEOUT_MS = 20_000
/** How long the viewfinder waits for a human. Generous on purpose — finding the
 *  right photo on a slow retailer page is a minutes-long job, and the honest
 *  end of a session the user walked away from is the closed tab, not this. */
const DEFAULT_FRAME_TIMEOUT_MS = 5 * 60_000
/** After `load` fires there is still layout and lazy-loading to come. */
const DEFAULT_SETTLE_MS = 800
const POPUP_WIDTH = 1280
const POPUP_HEIGHT = 960
/** Matches the cap on `POST /api/studio/cutout`: bigger cannot be used anyway,
 *  and base64 of a 50 MB file would just be a slower way to fail. */
const MAX_BYTES = 20 * 1024 * 1024
/** Comfortably inside Chromium's ~30 s idle-termination window. */
const KEEPALIVE_MS = 20_000

export interface TabInfo {
  id?: number
  status?: string
}

export interface WindowInfo {
  id?: number
  tabs?: TabInfo[]
}

/** Only the slice of the extension API this file uses, so tests can fake it. */
export interface BrowserLike {
  runtime: {
    getURL(path: string): string
    /** Only ever called to keep the worker alive; the answer is discarded. */
    getPlatformInfo?(): Promise<unknown>
  }
  permissions: { contains(p: { origins: string[] }): Promise<boolean> }
  windows: {
    create(opts: Record<string, unknown>): Promise<WindowInfo>
    remove(windowId: number): Promise<void>
    update(windowId: number, opts: Record<string, unknown>): Promise<unknown>
  }
  tabs: {
    create(opts: Record<string, unknown>): Promise<TabInfo>
    get(tabId: number): Promise<TabInfo>
    remove(tabId: number): Promise<void>
    onUpdated: {
      addListener(fn: (tabId: number, info: { status?: string }) => void): void
      removeListener(fn: (tabId: number, info: { status?: string }) => void): void
    }
    /** Closing a popup window removes its tab, so this covers both the window
     *  and the background-tab fallback with one listener. */
    onRemoved: {
      addListener(fn: (tabId: number) => void): void
    }
  }
  scripting: {
    executeScript(opts: Record<string, unknown>): Promise<{ result?: unknown }[]>
  }
}

export interface RouterDeps {
  api: BrowserLike
  fetchImpl?: typeof fetch
  version?: string
  ttlMs?: number
  loadTimeoutMs?: number
  settleMs?: number
  frameTimeoutMs?: number
  now?: () => number
  newId?: () => string
  schedule?: (fn: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
  /** Hold the background context open while any session is alive. See
   *  `defaultKeepAlive` for why this exists at all. */
  keepAlive?: (active: boolean) => void
  log?: (...args: unknown[]) => void
}

interface Session {
  id: string
  windowId: number | null
  tabId: number | null
  timer: unknown
}

/** A `harvest` parked on a human. */
interface PendingFrame {
  resolve(harvest: RawHarvest): void
  reject(err: Error): void
  timer: unknown
  tabId: number
}

export interface Router {
  handle(msg: unknown): Promise<Reply>
  /** Test seams. Not used by `sw.ts`. */
  sessionCount(): number
  sessionWindow(sessionId: string): number | null | undefined
  /** Harvests currently parked on a human. Must return to 0 on every exit path. */
  pendingCount(): number
}

/**
 * Injected into the retailer page to arm the already-injected bundle.
 *
 * Serialized by the browser, so it must reference nothing outside itself — that
 * constraint is the entire reason `injected.js` is a separate bundle rather than
 * one enormous function. The session id travels through `args` so the overlay's
 * eventual message can name its own session instead of us having to infer it from
 * the sender's tab.
 *
 * `executeScript` awaits the returned promise, which here settles as soon as the
 * viewfinder is on screen — the *user's* part is awaited over the message channel,
 * not through this call.
 */
function armInjectedFrame(sessionId: string): unknown {
  return (
    globalThis as unknown as { __dripdHarvest: { arm(id: string): unknown } }
  ).__dripdHarvest.arm(sessionId)
}

/** Injected on `surface`, so the user looking at the retailer page knows why. */
function showRetryBanner(): void {
  var id = '__dripd_retry_banner'
  if (document.getElementById(id)) return
  var el = document.createElement('div')
  el.id = id
  el.textContent = 'dripd: sæt billedet i rammen, og tryk “Hent billeder” igen.'
  el.setAttribute(
    'style',
    'position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:14px 18px;' +
      'background:#111;color:#fff;text-align:center;' +
      'font:600 15px/1.4 system-ui,-apple-system,sans-serif;',
  )
  document.documentElement.appendChild(el)
}

/**
 * Keep the background context alive while a capture is in flight.
 *
 * MV3 terminates an idle service worker after roughly 30 seconds, which would take
 * the session map and its TTL timer with it — the user picks an image half a minute
 * after the harvest, gets `no_session`, and the popup we opened is left orphaned
 * with nothing alive to dismiss it. Persisting sessions instead would mean adding
 * the `storage` permission for state that is meaningless once the worker restarts.
 *
 * Any extension API call resets the idle timer, so one throwaway call every 20 s is
 * enough. It runs only while a session exists, so it can never outlive a capture.
 */
function defaultKeepAlive(api: BrowserLike): (active: boolean) => void {
  let handle: ReturnType<typeof setInterval> | null = null
  return (active) => {
    if (active && handle === null) {
      handle = setInterval(() => {
        void api.runtime.getPlatformInfo?.().catch(() => {})
      }, KEEPALIVE_MS)
    } else if (!active && handle !== null) {
      clearInterval(handle)
      handle = null
    }
  }
}

function looksLikeHarvest(value: unknown): value is RawHarvest {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { images?: unknown }).images)
  )
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000 // unchunked, a multi-megabyte image blows the call stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function createRouter(deps: RouterDeps): Router {
  const { api } = deps
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const version = deps.version ?? '0.0.0'
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS
  const loadTimeoutMs = deps.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS
  const frameTimeoutMs = deps.frameTimeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS
  const newId = deps.newId ?? (() => crypto.randomUUID())
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms))
  const cancel = deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const log = deps.log ?? (() => {})
  const keepAlive = deps.keepAlive ?? defaultKeepAlive(api)

  const sessions = new Map<string, Session>()
  const pending = new Map<string, PendingFrame>()

  /** Called after every change to `sessions`, never on its own. */
  function syncKeepAlive(): void {
    keepAlive(sessions.size > 0)
  }

  /** Settle a waiting `harvest`, once. Every exit from the framing state goes
   *  through here so the timer is always cancelled and the map never leaks. */
  function settleFrame(sessionId: string, outcome: RawHarvest | Error): boolean {
    const p = pending.get(sessionId)
    if (!p) return false
    pending.delete(sessionId)
    cancel(p.timer)
    if (outcome instanceof Error) p.reject(outcome)
    else p.resolve(outcome)
    return true
  }

  // A closed popup is the user saying no. Without this the studio would sit on a
  // spinner until the frame timeout, with nothing left on screen to explain it.
  try {
    api.tabs.onRemoved.addListener((tabId) => {
      for (const [id, p] of pending) {
        if (p.tabId === tabId) settleFrame(id, new Error(ERR.windowClosed))
      }
    })
  } catch (e) {
    log('tabs.onRemoved unavailable', e)
  }

  function awaitFrame(sessionId: string, tabId: number): Promise<RawHarvest> {
    return new Promise<RawHarvest>((resolve, reject) => {
      const timer = schedule(() => {
        pending.delete(sessionId)
        reject(new Error(ERR.frameTimeout))
      }, frameTimeoutMs)
      pending.set(sessionId, { resolve, reject, timer, tabId })
    })
  }

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      schedule(resolve, ms)
    })

  async function closeWindow(session: Session): Promise<void> {
    const { windowId, tabId } = session
    // Cleared first: a failed remove must not leave us retrying it forever.
    session.windowId = null
    session.tabId = null
    try {
      if (windowId != null) await api.windows.remove(windowId)
      else if (tabId != null) await api.tabs.remove(tabId)
    } catch {
      /* already gone — the user may have closed it */
    }
  }

  function arm(session: Session): void {
    cancel(session.timer)
    session.timer = schedule(() => {
      log('session expired', session.id)
      sessions.delete(session.id)
      syncKeepAlive()
      void closeWindow(session)
    }, ttlMs)
  }

  /** Visible and unfocused if the browser allows it, focused if not, a background
   *  tab if it refuses popups altogether. */
  async function openPopup(url: string): Promise<{ windowId: number | null; tabId: number } | null> {
    const attempts: Array<() => Promise<WindowInfo>> = [
      () =>
        api.windows.create({
          url,
          type: 'popup',
          focused: false,
          width: POPUP_WIDTH,
          height: POPUP_HEIGHT,
        }),
      () => api.windows.create({ url, type: 'popup', width: POPUP_WIDTH, height: POPUP_HEIGHT }),
    ]

    for (const attempt of attempts) {
      try {
        const win = await attempt()
        const tabId = win?.tabs?.[0]?.id
        if (win?.id != null && tabId != null) return { windowId: win.id, tabId }
      } catch (e) {
        log('windows.create failed', e)
      }
    }

    try {
      const tab = await api.tabs.create({ url, active: false })
      if (tab?.id != null) return { windowId: null, tabId: tab.id }
    } catch (e) {
      log('tabs.create failed', e)
    }

    return null
  }

  /** Resolve when the tab reports `complete`, or when the budget runs out —
   *  a slow page still gets harvested, it just gets harvested early. */
  function waitForLoad(tabId: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false
      let timer: unknown = null

      const finish = () => {
        if (settled) return
        settled = true
        try {
          api.tabs.onUpdated.removeListener(listener)
        } catch {
          /* ignore */
        }
        if (timer !== null) cancel(timer)
        resolve()
      }

      const listener = (id: number, info: { status?: string }) => {
        if (id === tabId && info.status === 'complete') finish()
      }

      api.tabs.onUpdated.addListener(listener)
      timer = schedule(finish, loadTimeoutMs)

      // The tab can reach `complete` before the listener is attached.
      api.tabs
        .get(tabId)
        .then((tab) => {
          if (tab?.status === 'complete') finish()
        })
        .catch(() => {
          /* the tab may be mid-navigation; the listener still covers us */
        })
    })
  }

  async function harvest(rawUrl: unknown): Promise<Reply> {
    const target = safeHttpsUrl(rawUrl)
    if (!target) return { ok: false, error: ERR.badUrl }

    const origins = [`${target.origin}/*`]
    let granted = false
    try {
      granted = await api.permissions.contains({ origins })
    } catch (e) {
      log('permissions.contains failed', e)
    }
    if (!granted) {
      // The grant needs a user gesture, and a relayed click carries none
      // (crbug.com/1284891), so it has to be asked for from our own page.
      try {
        await api.tabs.create({ url: api.runtime.getURL('onboarding.html'), active: true })
      } catch (e) {
        log('could not open onboarding', e)
      }
      return { ok: false, error: ERR.needsPermission }
    }

    const opened = await openPopup(target.href)
    if (!opened) return { ok: false, error: ERR.openFailed }

    const session: Session = {
      id: newId(),
      windowId: opened.windowId,
      tabId: opened.tabId,
      timer: null,
    }

    // Registered *before* the user frames anything, unlike the old auto-harvest:
    // framing takes minutes, and the keep-alive that stops MV3 idle-terminating
    // this worker mid-wait is driven by the session count. The TTL is armed only
    // once a harvest actually arrives — until then the frame timeout is the
    // bound, and it is far longer than 60 s.
    sessions.set(session.id, session)
    syncKeepAlive()

    try {
      await waitForLoad(opened.tabId)
      await wait(settleMs)
      await api.scripting.executeScript({
        target: { tabId: opened.tabId },
        files: ['injected.js'],
      })

      // Registered before arming, not after: the user can press the button the
      // instant the viewfinder appears, and a message arriving before there is
      // anything waiting for it would be dropped as a stray.
      const framed = awaitFrame(session.id, opened.tabId)
      // Marks the rejection handled without consuming it: if arming throws below,
      // we never reach `await framed`, and an unhandled rejection in a service
      // worker is a console error in the user's face for a case we handle here.
      void framed.catch(() => {})
      await api.scripting.executeScript({
        target: { tabId: opened.tabId },
        func: armInjectedFrame,
        args: [session.id],
      })
      log('framing', session.id, target.href)

      const result = await framed

      arm(session)
      const meta = (result as RawHarvest & { meta?: unknown }).meta
      log('harvest', session.id, `${result.images.length} images`, meta)

      // The window stays open on purpose: the page has not ranked yet, and if the
      // ranking finds nothing usable the user needs it surfaced, not gone.
      return { ok: true, sessionId: session.id, harvest: result }
    } catch (e) {
      const message = (e as Error).message ?? String(e)
      log('harvest failed', message)
      settleFrame(session.id, new Error(message))
      sessions.delete(session.id)
      syncKeepAlive()
      await closeWindow(session)
      // The three ways a human ends a framing session are not extension
      // failures, and the studio maps them to their own copy — so they travel
      // as themselves rather than wrapped in `inject_failed`.
      const bare: string[] = [ERR.windowClosed, ERR.frameTimeout]
      return { ok: false, error: bare.includes(message) ? message : `${ERR.injectFailed}:${message}` }
    }
  }

  /**
   * The overlay reporting in. Not reachable from the page: `bridge.ts` relays
   * whatever the studio sends, but a `framed` message needs a session id that
   * only ever existed inside the popup, and settling a promise nobody is holding
   * is a no-op.
   */
  function acceptFrame(rawSessionId: unknown, rawHarvest: unknown, cancelled: unknown): Reply {
    if (typeof rawSessionId !== 'string') return { ok: false, error: ERR.noSession }

    if (cancelled === true) {
      settleFrame(rawSessionId, new Error(ERR.windowClosed))
      return { ok: true }
    }
    if (!looksLikeHarvest(rawHarvest)) {
      settleFrame(rawSessionId, new Error(`unexpected harvest shape: ${typeof rawHarvest}`))
      return { ok: false, error: ERR.injectFailed }
    }
    // A second press after the studio already has its harvest is not an error —
    // the overlay stays mounted on purpose, so this is a normal thing to see.
    settleFrame(rawSessionId, rawHarvest)
    return { ok: true }
  }

  async function fetchBytes(rawSessionId: unknown, rawUrl: unknown): Promise<Reply> {
    const session = typeof rawSessionId === 'string' ? sessions.get(rawSessionId) : undefined
    if (!session) return { ok: false, error: ERR.noSession }

    const target = safeHttpsUrl(rawUrl)
    if (!target) return { ok: false, error: ERR.badUrl }

    try {
      // `credentials: 'include'` matters: some CDNs behind bot management answer
      // an anonymous request differently from a session-carrying one. This is the
      // only context where a cross-origin read is possible at all.
      const res = await doFetch(target.href, { credentials: 'include' })
      if (!res.ok) return { ok: false, error: `${ERR.fetchFailed}:HTTP ${res.status}` }

      const buffer = await res.arrayBuffer()
      if (buffer.byteLength === 0) return { ok: false, error: `${ERR.fetchFailed}:empty` }
      if (buffer.byteLength > MAX_BYTES) return { ok: false, error: ERR.tooLarge }

      const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0]?.trim()
      arm(session) // the pick happened, so the user is still working
      log('fetched', buffer.byteLength, 'bytes', mimeType)

      return {
        ok: true,
        base64: toBase64(new Uint8Array(buffer)),
        mimeType: mimeType || 'image/jpeg',
      }
    } catch (e) {
      return { ok: false, error: `${ERR.fetchFailed}:${(e as Error).message ?? String(e)}` }
    }
  }

  async function resolveWindow(rawSessionId: unknown, rawAction: unknown): Promise<Reply> {
    const session = typeof rawSessionId === 'string' ? sessions.get(rawSessionId) : undefined
    // Idempotent: an already-expired session is a window that is already gone,
    // which is precisely what the caller wanted.
    if (!session) return { ok: true }

    const action: ResolveAction = rawAction === 'surface' ? 'surface' : 'dismiss'

    if (action === 'dismiss') {
      await closeWindow(session)
      return { ok: true }
    }

    if (session.windowId != null) {
      try {
        await api.windows.update(session.windowId, { focused: true, drawAttention: true })
      } catch (e) {
        log('surface failed', e)
      }
    }
    if (session.tabId != null) {
      try {
        await api.scripting.executeScript({
          target: { tabId: session.tabId },
          func: showRetryBanner,
        })
      } catch (e) {
        log('banner failed', e)
      }
    }
    return { ok: true }
  }

  async function handle(msg: unknown): Promise<Reply> {
    const req = msg as Partial<Req> | null
    switch (req?.kind) {
      case 'ping':
        return { ok: true, version }
      case 'harvest':
        return harvest((req as { url?: unknown }).url)
      case 'fetchBytes':
        return fetchBytes((req as { sessionId?: unknown }).sessionId, (req as { url?: unknown }).url)
      case 'resolve':
        return resolveWindow(
          (req as { sessionId?: unknown }).sessionId,
          (req as { action?: unknown }).action,
        )
      case 'framed':
        return acceptFrame(
          (req as { sessionId?: unknown }).sessionId,
          (req as { harvest?: unknown }).harvest,
          (req as { cancelled?: unknown }).cancelled,
        )
      default:
        return { ok: false, error: `${ERR.unknownKind}:${String(req?.kind)}` }
    }
  }

  return {
    handle,
    sessionCount: () => sessions.size,
    sessionWindow: (id) => sessions.get(id)?.windowId,
    pendingCount: () => pending.size,
  }
}
