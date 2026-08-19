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
 * signal, so it is arguably more suspicious rather than safer. A real, visible
 * popup that closes itself is both more honest and more effective.
 *
 * It is also **focused**, which it was not originally. Once the user became the
 * one operating that window, a popup opening behind the browser meant the studio
 * asked them to frame a photo in a window they could not see.
 */

import {
  ERR,
  safeHttpsUrl,
  type RawHarvest,
  type Reply,
  type Req,
  type ResolveAction,
} from './protocol'

/** A session with no fetch activity is dead weight; the popup it owns is worse.
 *  Extended by every `fetchBytes`, so an active capture never trips it. */
const DEFAULT_TTL_MS = 60_000
/** How long the viewfinder waits for a human. Generous on purpose — finding the
 *  right photo on a slow retailer page is a minutes-long job, and the honest
 *  end of a session the user walked away from is the closed tab, not this. */
const DEFAULT_FRAME_TIMEOUT_MS = 5 * 60_000
const POPUP_WIDTH = 1280
const POPUP_HEIGHT = 960
/** Matches the cap on `POST /api/studio/cutout`: bigger cannot be used anyway,
 *  and base64 of a 50 MB file would just be a slower way to fail. */
const MAX_BYTES = 20 * 1024 * 1024
/** Comfortably inside Chromium's ~30 s idle-termination window. */
const KEEPALIVE_MS = 20_000
/**
 * The page the popup opens on.
 *
 * Pointing the window straight at the retailer meant there was no document until
 * that server answered, and nothing can be injected into a tab that has none — so
 * on a slow shop the cover landed late and the user watched the browser's own
 * blank page. This is read from disk, so it paints as fast as the window appears,
 * and the retailer is navigated to afterwards.
 */
const LOADING_PAGE = 'loading.html'
/**
 * How long to wait for that page before going on without it.
 *
 * It is markup and CSS read from disk, so this is generous already. The wait
 * exists because `windows.create` resolves when the *window* exists and not when
 * its tab has loaded — but a page that somehow never reports `complete` must not
 * hold a capture hostage, so the budget is short and missing it is survivable.
 */
const DEFAULT_LOADING_PAGE_TIMEOUT_MS = 2_000

export interface TabInfo {
  id?: number
  status?: string
  /** Needs the `tabs` permission, which we have. Only ever read for diagnostics. */
  url?: string
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
    /** Sends the popup on from our loading page to the retailer. */
    update(tabId: number, opts: Record<string, unknown>): Promise<TabInfo>
    /** The authority on which tabs a window owns. `windows.create` is not. */
    query(info: Record<string, unknown>): Promise<TabInfo[]>
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
    /** One per capture, at `document_start`, for the retailer's origin. */
    registerContentScripts(scripts: Record<string, unknown>[]): Promise<void>
    unregisterContentScripts(filter: { ids: string[] }): Promise<void>
  }
}

export interface RouterDeps {
  api: BrowserLike
  fetchImpl?: typeof fetch
  version?: string
  ttlMs?: number
  loadingPageTimeoutMs?: number
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
  /** The `document_start` registration made for this capture, undone when the
   *  window closes. */
  scriptId: string
  windowId: number | null
  /** The tab the retailer loads in — the one the viewfinder ends up on. */
  tabId: number | null
  /**
   * The tab showing `loading.html`, until the retailer's tab takes over.
   *
   * Two tabs rather than one navigation, because a navigation is the one moment
   * nothing can be painted. Firefox holds the previous page's pixels only for
   * same-origin navigations, and `moz-extension:` to `https:` is neither
   * same-origin nor same-process — so for the length of the retailer's
   * time-to-first-byte the window showed the browser's own background, and no
   * content script can cover a document that does not exist yet. Loading it in a
   * second tab means the visible tab is never navigated at all.
   */
  loadingTabId: number | null
  timer: unknown
}

/** Who sent a message. Only `ready` cares, and only about the tab. */
export interface MessageSender {
  tab?: { id?: number }
}

/** A `harvest` parked on a human. */
interface PendingFrame {
  resolve(harvest: RawHarvest): void
  reject(err: Error): void
  timer: unknown
  tabId: number
}

export interface Router {
  handle(msg: unknown, sender?: MessageSender): Promise<Reply>
  /** Test seams. Not used by `sw.ts`. */
  sessionCount(): number
  sessionWindow(sessionId: string): number | null | undefined
  /** Harvests currently parked on a human. Must return to 0 on every exit path. */
  pendingCount(): number
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
  const loadingPageTimeoutMs = deps.loadingPageTimeoutMs ?? DEFAULT_LOADING_PAGE_TIMEOUT_MS
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

  async function closeWindow(session: Session): Promise<void> {
    const { windowId, tabId, loadingTabId, scriptId } = session
    // Cleared first: a failed remove must not leave us retrying it forever.
    session.windowId = null
    session.tabId = null
    session.loadingTabId = null

    // The registration is undone here rather than when `harvest` returns,
    // because the window outliving the harvest is the point: on an empty
    // ranking the studio surfaces it again and the user re-frames, and until
    // the window is gone a navigation still needs to re-arm the viewfinder.
    // Unconditional and swallowed — an id that was never registered is exactly
    // as fine as one that was.
    try {
      await api.scripting.unregisterContentScripts({ ids: [scriptId] })
    } catch (e) {
      log('could not unregister', scriptId, e)
    }
    if (windowId != null) {
      try {
        await api.windows.remove(windowId)
      } catch {
        /* already gone — the user may have closed it */
      }
    }

    // Every tab this capture opened, whether or not a window was supposed to
    // take them with it.
    //
    // Removing the window is not enough on its own: Safari already resolves
    // `windows.create` without its documented `tabs` array, and an engine that
    // does that is not one to trust with `tabs.create({ windowId })` either. A
    // capture tab that was never in the popup outlives it — and then pressing
    // Hent billeder reads as doing nothing at all, because the harvest lands in
    // the studio while the page the user is looking at just sits there.
    //
    // One `try` each rather than one around the loop: on the engines where the
    // window did take its tabs, the first removal throws, and a shared catch
    // would skip every removal after it.
    for (const id of [tabId, loadingTabId]) {
      if (id == null) continue
      try {
        await api.tabs.remove(id)
      } catch {
        /* the window took it, or the user closed it */
      }
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

  /**
   * Which tab a freshly created window owns.
   *
   * `windows.create` is documented to echo back a `tabs` array, and Chrome and
   * Firefox do. **Safari resolves without one.** Treating that absence as failure
   * meant abandoning a perfectly good window and opening another — the user got
   * two popups, and the eventual injection went into a fallback tab that was
   * never the retailer's page, so no viewfinder ever appeared.
   *
   * So ask the tabs API, which is the actual authority, and only fall back to
   * what `create` echoed.
   */
  async function resolveWindowTab(win: WindowInfo): Promise<number | null> {
    const echoed = win?.tabs?.[0]?.id
    if (echoed != null) return echoed
    if (win?.id == null) return null
    try {
      const tabs = await api.tabs.query({ windowId: win.id })
      return tabs?.[0]?.id ?? null
    } catch (e) {
      log('tabs.query failed', e)
      return null
    }
  }

  /**
   * A focused popup, falling back to whatever the browser will give us.
   *
   * This opened unfocused at first, to be unobtrusive. That was right when the
   * extension harvested by itself and the window was incidental — it is wrong now
   * that the window is where the user does the work. An unfocused popup opens
   * *behind* the browser, so the studio says "frame the photo" while the thing to
   * frame it in is invisible.
   */
  async function openPopup(url: string): Promise<{ windowId: number | null; tabId: number } | null> {
    const attempts: Array<() => Promise<WindowInfo>> = [
      () =>
        api.windows.create({
          url,
          type: 'popup',
          focused: true,
          width: POPUP_WIDTH,
          height: POPUP_HEIGHT,
        }),
      () => api.windows.create({ url, type: 'popup', width: POPUP_WIDTH, height: POPUP_HEIGHT }),
    ]

    for (let i = 0; i < attempts.length; i++) {
      try {
        const win = await attempts[i]!()
        // Which attempt won, and which tab we were handed. A popup showing the
        // wrong page is either the wrong URL requested or the right URL into
        // somebody else's tab, and only the tab id tells those apart.
        log('windows.create', { attempt: i, windowId: win?.id, tabCount: win?.tabs?.length })
        if (win?.id == null) continue

        const tabId = await resolveWindowTab(win)
        if (tabId != null) {
          // Safari ignores `focused` on create often enough that asking again
          // afterwards is the difference between a window the user can see and
          // one behind everything else.
          try {
            await api.windows.update(win.id, { focused: true })
          } catch {
            /* not fatal — the window exists either way */
          }
          return { windowId: win.id, tabId }
        }

        // A window we cannot address is worse than no window: it sits on screen
        // and the next attempt opens another one beside it.
        log('opened a window with no reachable tab; closing it', win.id)
        try {
          await api.windows.remove(win.id)
        } catch {
          /* ignore */
        }
      } catch (e) {
        log('windows.create failed', e)
      }
    }

    try {
      // Active, for the same reason: a background tab the user never sees is a
      // viewfinder they can never reach.
      const tab = await api.tabs.create({ url, active: true })
      if (tab?.id != null) return { windowId: null, tabId: tab.id }
    } catch (e) {
      log('tabs.create failed', e)
    }

    return null
  }

  /**
   * Resolve when the tab reports `complete` **on the page we are waiting for**,
   * or when the budget runs out — a slow page still gets harvested, it just gets
   * harvested early.
   *
   * `isTarget` rather than an origin string because the two callers ask
   * different questions: the retailer is an origin, and our own loading page is
   * one exact URL whose origin is unusable.
   *
   * Which page is not a refinement of the question. The popup opens on the
   * extension's own page, so a `complete` can mean either "our spinner is up"
   * or "the shop is loaded", and the two lead to opposite actions.
   */
  function waitForLoad(
    tabId: number,
    isTarget: (url: string | undefined) => boolean,
    timeoutMs: number,
  ): Promise<void> {
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

      // `complete` says a document finished; only the tab's URL says which one.
      const checkTab = () => {
        api.tabs
          .get(tabId)
          .then((tab) => {
            if (tab?.status === 'complete' && isTarget(tab.url)) finish()
          })
          .catch(() => {
            /* the tab may be mid-navigation; the listener still covers us */
          })
      }

      const listener = (id: number, info: { status?: string }) => {
        if (id === tabId && info.status === 'complete') checkTab()
      }

      api.tabs.onUpdated.addListener(listener)
      timer = schedule(finish, timeoutMs)

      // The tab can reach `complete` before the listener is attached.
      checkTab()
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

    const loadingUrl = api.runtime.getURL(LOADING_PAGE)
    const opened = await openPopup(loadingUrl)
    if (!opened) return { ok: false, error: ERR.openFailed }

    const sessionId = newId()
    const session: Session = {
      id: sessionId,
      scriptId: `dripd-capture-${sessionId}`,
      windowId: opened.windowId,
      // Filled in once the retailer's tab exists; until then the popup is
      // showing our loading page and there is nothing to capture in.
      tabId: null,
      loadingTabId: opened.tabId,
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
      // Wait for our own page to actually BE on screen.
      //
      // `windows.create` resolves when the window exists, not when its tab has
      // loaded, and everything between here and the navigation is synchronous.
      // Without this the retailer is navigated to within milliseconds, the
      // loading page is left before it ever paints, and the user watches the
      // shop load exactly as they did before this page existed. Opening on our
      // own page buys nothing unless something waits for it.
      //
      // Matched by URL prefix rather than origin: an extension URL's origin is
      // the string "null".
      await waitForLoad(
        opened.tabId,
        (u) => !!u && u.startsWith(loadingUrl),
        loadingPageTimeoutMs,
      )

      /**
       * One registration, for this capture, at `document_start`.
       *
       * This is what replaced the injection race. The bundle used to be pushed
       * in with `executeScript` after the load wait and the settle — by which
       * point the shop had been fully visible for the better part of a second —
       * and armed with a second call. Firefox blocks injection into our own
       * extension page, `tabs.update` does not change a tab's URL synchronously,
       * and neither fact can be worked around by moving a listener; that was
       * tried three times.
       *
       * The browser now runs the bundle before each document paints: the first
       * one, and every one a redirect or a reload produces. A navigation stops
       * losing the viewfinder and starts re-arming it.
       *
       * `persistAcrossSessions: false` because the default is **true**. A
       * registration left behind would keep running on that shop, in every tab
       * and every window, until the browser restarts.
       */
      await api.scripting.registerContentScripts([
        {
          id: session.scriptId,
          js: ['injected.js'],
          matches: [`${target.origin}/*`],
          runAt: 'document_start',
          allFrames: false,
          persistAcrossSessions: false,
        },
      ])

      // The retailer loads in its own tab, behind the one showing the spinner.
      // `active: false` is the whole trick: a tab nobody is looking at can take
      // as long as it likes to answer, and the window keeps painting the page it
      // already has.
      //
      // Created empty and navigated afterwards, rather than created on the URL,
      // so that `session.tabId` is known before anything can load in it. `ready`
      // is answered by matching that id, and a bundle asking before we know it
      // would be told to stand down and would never arm. The navigation costs
      // nothing here — this tab has never been visible.
      const captureTab = await api.tabs.create(
        opened.windowId != null
          ? { windowId: opened.windowId, active: false }
          : { active: false },
      )
      if (captureTab?.id == null) throw new Error(ERR.openFailed)
      session.tabId = captureTab.id

      // Registered before the navigation, not after. The bundle arms itself at
      // `document_start`, so a harvest can come back the instant the page is up,
      // and a message arriving before anything waits for it is dropped as a
      // stray — leaving the capture hanging until the frame timeout.
      const framed = awaitFrame(session.id, captureTab.id)
      // Marks the rejection handled without consuming it: if anything below
      // throws we never reach `await framed`, and an unhandled rejection in a
      // service worker is a console error in the user's face for a case we
      // handle here.
      void framed.catch(() => {})
      log('framing', session.id, target.href)

      await api.tabs.update(captureTab.id, { url: target.href })

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

  /**
   * Which capture, if any, owns the tab this message came from.
   *
   * The one question in this protocol that the sender cannot answer itself. The
   * bundle is registered for the retailer's ORIGIN, so it also runs in whatever
   * other tabs the user has open on that shop — from the page there is nothing
   * to tell them apart. A tab with no session gets told so and stands down,
   * taking its own cover back off.
   */
  function readyFor(sender: MessageSender | undefined): Reply {
    const tabId = sender?.tab?.id
    if (tabId == null) return { ok: false, error: ERR.noSession }
    for (const session of sessions.values()) {
      if (session.tabId === tabId) {
        // The bundle installs its cover before it asks this, so by the time we
        // answer, that tab's document already carries the same spinner the
        // visible tab is showing. Swapping now is the handover, and it is
        // invisible precisely because both sides are drawn the same.
        void revealCaptureTab(session)
        return { ok: true, sessionId: session.id }
      }
    }
    return { ok: false, error: ERR.noSession }
  }

  /** Show the retailer's tab and drop the loading one. Once per session. */
  async function revealCaptureTab(session: Session): Promise<void> {
    const loadingTabId = session.loadingTabId
    if (loadingTabId == null || session.tabId == null) return
    // Cleared first: a failed swap must not leave us retrying it on every
    // document the retailer's origin loads.
    session.loadingTabId = null
    try {
      await api.tabs.update(session.tabId, { active: true })
    } catch (e) {
      log('could not show the capture tab', e)
    }
    try {
      await api.tabs.remove(loadingTabId)
    } catch (e) {
      log('could not close the loading tab', e)
    }
  }

  async function handle(msg: unknown, sender?: MessageSender): Promise<Reply> {
    const req = msg as Partial<Req> | null
    switch (req?.kind) {
      case 'ready':
        return readyFor(sender)
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
