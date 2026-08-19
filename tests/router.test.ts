import { describe, expect, it, vi } from 'vitest'
import { createRouter, type BrowserLike, type Router } from '../src/router'
import type { RawHarvest } from '../src/protocol'

const PDP = 'https://www2.hm.com/da_dk/productpage.1358428002.html'
const IMG = 'https://image.hm.com/assets/hm/e2/74/e274.jpg?imwidth=2160'

const HARVEST: RawHarvest = {
  pageUrl: PDP,
  title: 'Skjorte',
  jsonld: [],
  og: [],
  images: [{ url: IMG, w: 595, h: 893 }],
}

/**
 * Delays under a second (the settle wait, the load timeout) run straight through;
 * anything longer is a session TTL, held so the test can fire it deliberately.
 */
function fakeTimers() {
  const pending = new Map<number, () => void>()
  let seq = 0
  return {
    pending,
    schedule(fn: () => void, ms: number) {
      const handle = ++seq
      if (ms < 1_000) queueMicrotask(fn)
      else pending.set(handle, fn)
      return handle
    },
    cancel(handle: unknown) {
      pending.delete(handle as number)
    },
    fireAll() {
      const fns = [...pending.values()]
      pending.clear()
      for (const fn of fns) fn()
    },
    handles() {
      return [...pending.keys()]
    },
  }
}

interface FakeOptions {
  granted?: boolean
  harvestResult?: unknown
  windowCreateFailures?: number
  /** Leave the viewfinder up instead of pressing the button, so a test can drive
   *  the ways a framing session ends without one. */
  autoFrame?: boolean
  /** Safari resolves `windows.create` without the documented `tabs` array. */
  omitCreatedTabs?: boolean
  /**
   * Hold the popup in `loading` so a test can drive the load itself.
   *
   * The default fake answers `tabs.get` with `complete`, which short-circuits
   * `waitForLoad` before its listener ever matters — fine for the tests that
   * only care about what happens afterwards, useless for anything about the
   * window in which the page is visible and the viewfinder is not.
   */
  tabNeverComplete?: boolean
  /** Never run the retailer tab's bundle, so a test can drive the swap itself. */
  stallNavigation?: boolean
  /** Reject the creation of the retailer's tab. */
  captureTabFails?: boolean
  /** Reject the `document_start` registration. */
  registerFails?: boolean
  /**
   * The popup's tab starts in `loading`, as a real one does.
   *
   * `windows.create` resolves when the window exists, not when its tab has
   * loaded — so a fake that reports `complete` from the first instant hides the
   * entire question of whether the router waits for its own page to be on
   * screen before navigating off it.
   */
  popupStartsLoading?: boolean
  /** Budget for the wait on our own loading page. */
  loadingPageTimeoutMs?: number
}

function fakeApi(opts: FakeOptions = {}) {
  const granted = opts.granted ?? true
  let windowFailures = opts.windowCreateFailures ?? 0
  let nextId = 100
  const closeListeners: ((tabId: number) => void)[] = []
  const updateListeners: ((tabId: number, info: { status?: string }) => void)[] = []
  const windowTabs = new Map<number, number>()
  /** What each tab is currently showing. The popup opens on the extension's own
   *  loading page and only then navigates, so "which page" is now a question the
   *  router has to get right. */
  const tabUrls = new Map<number, string>()
  /** Per-tab load state, so a test can hold a tab mid-load and release it. */
  const tabStatus = new Map<number, string>()
  let onNavigated: ((tabId: number, url: string) => void) | null = null

  const log = {
    windowsCreated: [] as Record<string, unknown>[],
    windowsRemoved: [] as number[],
    windowsUpdated: [] as { id: number; opts: Record<string, unknown> }[],
    tabsCreated: [] as Record<string, unknown>[],
    tabsUpdated: [] as { tabId: number; opts: Record<string, unknown> }[],
    tabsRemoved: [] as number[],
    scripts: [] as Record<string, unknown>[],
    registered: [] as Record<string, unknown>[],
    unregistered: [] as string[],
    /** Whatever the popup ended up being, window or fallback tab. */
    tabIds: [] as number[],
    /** The tab the retailer was loaded into, behind the loading page. */
    captureTabId: null as number | null,
  }

  const api: BrowserLike = {
    runtime: { getURL: (p) => `chrome-extension://dripd/${p}` },
    permissions: { contains: () => Promise.resolve(granted) },
    windows: {
      create(options) {
        log.windowsCreated.push(options)
        if (windowFailures > 0) {
          windowFailures -= 1
          return Promise.reject(new Error('popups not allowed'))
        }
        const id = nextId++
        const tabId = nextId++
        log.tabIds.push(tabId)
        windowTabs.set(id, tabId)
        tabUrls.set(tabId, String(options.url ?? ''))
        tabStatus.set(tabId, opts.popupStartsLoading ? 'loading' : 'complete')
        // Safari answers without the documented `tabs` array; the window and its
        // tab both exist, `create` just does not say so.
        return Promise.resolve(opts.omitCreatedTabs ? { id } : { id, tabs: [{ id: tabId }] })
      },
      remove(id) {
        log.windowsRemoved.push(id)
        return Promise.resolve()
      },
      update(id, options) {
        log.windowsUpdated.push({ id, opts: options })
        return Promise.resolve(null)
      },
    },
    tabs: {
      create(options) {
        log.tabsCreated.push(options)
        if (opts.captureTabFails) return Promise.reject(new Error('cannot create a tab'))
        const id = nextId++
        const url = String(options.url ?? '')
        // The onboarding tab is not a popup; the fallback tab is, and both are
        // now created active, so the URL is what tells them apart.
        if (!url.includes('onboarding')) log.tabIds.push(id)
        tabUrls.set(id, url)
        tabStatus.set(id, opts.popupStartsLoading ? 'loading' : 'complete')
        // A tab created with no URL is the hidden one the retailer is about to
        // be loaded into; everything else is a popup or the onboarding page.
        if (!url) log.captureTabId = id
        return Promise.resolve({ id })
      },
      update(tabId, options) {
        log.tabsUpdated.push({ tabId, opts: options })
        if (!opts.stallNavigation && typeof options.url === 'string') {
          tabUrls.set(tabId, options.url)
          // A navigation onto a registered origin is what actually runs the
          // bundle. Nothing else in this fake pretends to be the page.
          const url = options.url
          queueMicrotask(() => onNavigated?.(tabId, url))
        }
        return Promise.resolve({ id: tabId, url: tabUrls.get(tabId) })
      },
      get: (tabId) =>
        Promise.resolve({
          status: opts.tabNeverComplete ? 'loading' : (tabStatus.get(tabId) ?? 'complete'),
          url: tabUrls.get(tabId),
        }),
      query: (info) => {
        const id = (info as { windowId?: number }).windowId
        const tabId = id == null ? undefined : windowTabs.get(id)
        return Promise.resolve(tabId == null ? [] : [{ id: tabId }])
      },
      remove(id) {
        log.tabsRemoved.push(id)
        return Promise.resolve()
      },
      onUpdated: {
        addListener: (fn) => updateListeners.push(fn),
        removeListener: (fn) => {
          const i = updateListeners.indexOf(fn)
          if (i >= 0) updateListeners.splice(i, 1)
        },
      },
      onRemoved: { addListener: (fn) => closeListeners.push(fn) },
    },
    scripting: {
      executeScript(options) {
        log.scripts.push(options)
        return Promise.resolve([{}])
      },
      registerContentScripts(scripts) {
        if (opts.registerFails) return Promise.reject(new Error('cannot register'))
        log.registered.push(...scripts)
        return Promise.resolve()
      },
      unregisterContentScripts(filter) {
        log.unregistered.push(...filter.ids)
        return Promise.resolve()
      },
    },
  }

  return {
    api,
    log,
    /** The user closing the popup. */
    closeTab: (tabId: number) => closeListeners.forEach((fn) => fn(tabId)),
    /** A navigation the fake was told to stall finally committing. */
    navigateTab: (tabId: number, url: string) => tabUrls.set(tabId, url),
    /** The popup reporting progress — a navigation committing, or finishing. */
    updateTab: (tabId: number, status: string) => {
      tabStatus.set(tabId, status)
      ;[...updateListeners].forEach((fn) => fn(tabId, { status }))
    },
    setOnNavigated: (fn: (tabId: number, url: string) => void) => {
      onNavigated = fn
    },
  }
}

function fakeFetch(body: Uint8Array, init: { ok?: boolean; status?: number; type?: string } = {}) {
  return vi.fn(() =>
    Promise.resolve({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      headers: { get: () => init.type ?? 'image/jpeg' },
      arrayBuffer: () => Promise.resolve(body.buffer.slice(0) as ArrayBuffer),
    } as unknown as Response),
  )
}

function build(opts: FakeOptions = {}, fetchImpl?: typeof fetch) {
  const timers = fakeTimers()
  const { api, log, closeTab, updateTab, navigateTab, setOnNavigated } = fakeApi(opts)
  // Kept off the timer seam on purpose: a 20 s heartbeat sharing `schedule` would
  // show up in every TTL assertion in this file.
  const keepAlive: boolean[] = []
  let n = 0
  const router = createRouter({
    api,
    fetchImpl: fetchImpl ?? (fakeFetch(new Uint8Array([1, 2, 3])) as unknown as typeof fetch),
    version: '0.1.0',
    ttlMs: 60_000,
    loadingPageTimeoutMs: opts.loadingPageTimeoutMs ?? 10,
    newId: () => `s${++n}`,
    schedule: timers.schedule,
    cancel: timers.cancel,
    keepAlive: (active) => keepAlive.push(active),
  })
  /**
   * The bundle the registration causes, played straight.
   *
   * It runs on a navigation onto a registered origin, asks the router whose tab
   * it is over the real `ready` path, and stands down if the answer is nobody.
   * That handshake is the whole reason a content script registered for an
   * ORIGIN is safe to use for one tab, so the fake exercises it rather than
   * shortcutting it.
   */
  const armed: string[] = []
  setOnNavigated(async (tabId, url) => {
    const matched = log.registered.some((r) =>
      (r.matches as string[]).some((m) => url.startsWith(m.replace(/\*$/, ''))),
    )
    if (!matched) return
    const reply = await router.handle({ kind: 'ready' }, { tab: { id: tabId } })
    if (!reply.ok) return
    const sessionId = String((reply as { sessionId?: unknown }).sessionId)
    armed.push(sessionId)
    // Most tests care about what happens once a photo has been framed, so the
    // default fake presses the button as soon as the viewfinder is up.
    if (opts.autoFrame !== false) {
      void router.handle({
        kind: 'framed',
        sessionId,
        harvest: opts.harvestResult ?? HARVEST,
      })
    }
  })
  return { router, log, timers, keepAlive, closeTab, updateTab, navigateTab, armed }
}

const LOADING_PAGE = 'chrome-extension://dripd/loading.html'

/** The `tabs.update` calls that actually sent a tab somewhere. The rest are the
 *  swap making the retailer's tab the visible one. */
function navigations(log: { tabsUpdated: { tabId: number; opts: Record<string, unknown> }[] }) {
  return log.tabsUpdated.filter((u) => typeof u.opts.url === 'string')
}

/** Spin the microtask queue far enough for the router to have parked. */
async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

/**
 * Wait until the router is genuinely parked on the user.
 *
 * Getting there crosses the load wait, the settle wait and two `executeScript`
 * calls, all of which resolve as microtasks under `fakeTimers`. A fixed number of
 * `await Promise.resolve()` hops is a guess about that chain's length — and a
 * wrong guess does not fail, it hangs, because the framed message then arrives
 * before anything is listening for it.
 */
async function untilFraming(router: Router): Promise<void> {
  for (let i = 0; i < 500 && router.pendingCount() === 0; i++) await Promise.resolve()
  if (router.pendingCount() === 0) throw new Error('never reached the framing state')
}

/** Harvest once and hand back the session id. Every session test starts here. */
async function startSession(router: Router): Promise<string> {
  const reply = await router.handle({ kind: 'harvest', url: PDP })
  if (!reply.ok) throw new Error(`harvest failed: ${(reply as { error: string }).error}`)
  return String(reply.sessionId)
}

describe('ping', () => {
  it('answers with the version', async () => {
    const { router } = build()
    await expect(router.handle({ kind: 'ping' })).resolves.toEqual({ ok: true, version: '0.1.0' })
  })

  it('rejects an unknown verb rather than hanging', async () => {
    const { router } = build()
    const reply = await router.handle({ kind: 'teleport' })
    expect(reply).toMatchObject({ ok: false })
    expect((reply as { error: string }).error).toContain('unknown_kind')
  })
})

describe('harvest', () => {
  it('opens a focused popup and leaves it open', async () => {
    const { router, log } = build()

    const reply = await router.handle({ kind: 'harvest', url: PDP })

    expect(reply).toMatchObject({ ok: true, sessionId: 's1', harvest: HARVEST })
    // Which URL it opens on is its own test now; this one is about the window.
    expect(log.windowsCreated[0]).toMatchObject({ type: 'popup', focused: true })
    // The page has not ranked yet — closing here would leave nothing to recover with.
    expect(log.windowsRemoved).toEqual([])
    expect(router.sessionCount()).toBe(1)
  })

  it('refuses anything that is not an https URL', async () => {
    const { router, log } = build()

    for (const url of ['http://insecure.test/p', 'javascript:alert(1)', 'not a url', 42, null]) {
      await expect(router.handle({ kind: 'harvest', url })).resolves.toEqual({
        ok: false,
        error: 'bad_url',
      })
    }
    expect(log.windowsCreated).toEqual([])
  })

  it('sends the user to onboarding when host access is missing', async () => {
    const { router, log } = build({ granted: false })

    const reply = await router.handle({ kind: 'harvest', url: PDP })

    expect(reply).toEqual({ ok: false, error: 'needs_permission' })
    expect(log.tabsCreated[0]).toMatchObject({ url: 'chrome-extension://dripd/onboarding.html' })
    expect(log.windowsCreated).toEqual([])
    expect(router.sessionCount()).toBe(0)
  })

  it('opens ONE window when create answers without a tabs array', async () => {
    // Safari. `windows.create` resolves with the window and no `tabs`, and
    // treating that as failure opened a second popup beside the first — then a
    // third fallback tab, which is where the capture went, which is why no
    // viewfinder ever appeared on the retailer's page.
    const { router, log } = build({ omitCreatedTabs: true })

    const reply = await router.handle({ kind: 'harvest', url: PDP })

    expect(reply).toMatchObject({ ok: true })
    expect(log.windowsCreated).toHaveLength(1)
    expect(log.windowsRemoved).toEqual([])
    // The only tab created is the hidden one the retailer loads in, and it is
    // opened in the window `tabs.query` reported — not in one of its own.
    expect(log.tabsCreated).toEqual([{ windowId: 100, active: false }])
    expect(navigations(log)).toEqual([{ tabId: log.captureTabId, opts: { url: PDP } }])
  })

  it('asks for focus again after creating the window', async () => {
    // Safari ignores `focused` on create often enough that the popup opens
    // behind everything else.
    const { router, log } = build()
    await router.handle({ kind: 'harvest', url: PDP })

    expect(log.windowsUpdated[0]?.opts).toMatchObject({ focused: true })
  })

  it('falls back to a plain popup, then to a tab', async () => {
    const one = build({ windowCreateFailures: 1 })
    await expect(one.router.handle({ kind: 'harvest', url: PDP })).resolves.toMatchObject({ ok: true })
    expect(one.log.windowsCreated).toHaveLength(2)
    expect(one.log.windowsCreated[1]).not.toHaveProperty('focused')

    const both = build({ windowCreateFailures: 2 })
    await expect(both.router.handle({ kind: 'harvest', url: PDP })).resolves.toMatchObject({ ok: true })
    expect(both.log.tabsCreated[0]).toMatchObject({ active: true })
  })

  it('closes the window and keeps no session when the bundle cannot be registered', async () => {
    // Was `executeScript` failing; the bundle is registered rather than injected
    // now, but the obligation is the same — a capture that cannot put a
    // viewfinder on the page must not leave a window and a session behind.
    const { router, log } = build({ registerFails: true })

    const reply = await router.handle({ kind: 'harvest', url: PDP })

    expect(reply).toMatchObject({ ok: false })
    expect((reply as { error: string }).error).toContain('inject_failed')
    expect(log.windowsRemoved).toHaveLength(1)
    expect(router.sessionCount()).toBe(0)
  })

  it('rejects a harvest that came back the wrong shape', async () => {
    const { router } = build({ harvestResult: 'undefined is not an object' })
    const reply = await router.handle({ kind: 'harvest', url: PDP })
    expect(reply).toMatchObject({ ok: false })
    expect(router.sessionCount()).toBe(0)
    expect(router.pendingCount()).toBe(0)
  })
})

describe('framing — the harvest waits for a human', () => {
  it('collects nothing until the user presses the button', async () => {
    const { router, log } = build({ autoFrame: false })

    const inFlight = router.handle({ kind: 'harvest', url: PDP })
    await untilFraming(router)

    // The whole point of the change: the window is open, the viewfinder is up,
    // and nothing has been collected or returned.
    expect(router.pendingCount()).toBe(1)
    expect(log.windowsCreated).toHaveLength(1)
    let settled = false
    void inFlight.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    await router.handle({ kind: 'framed', sessionId: 's1', harvest: HARVEST })
    await expect(inFlight).resolves.toMatchObject({ ok: true, sessionId: 's1', harvest: HARVEST })
    expect(router.pendingCount()).toBe(0)
  })

  it('ends the session when the user closes the popup', async () => {
    const { router, log, closeTab } = build({ autoFrame: false })

    const inFlight = router.handle({ kind: 'harvest', url: PDP })
    await untilFraming(router)
    closeTab(log.captureTabId!)

    // Travels as itself, not wrapped in inject_failed: the studio has its own
    // copy for "you closed it", and that must not read like a crash.
    await expect(inFlight).resolves.toEqual({ ok: false, error: 'window_closed' })
    expect(router.sessionCount()).toBe(0)
    expect(router.pendingCount()).toBe(0)
  })

  it('ends the session when the user presses Annullér', async () => {
    const { router } = build({ autoFrame: false })

    const inFlight = router.handle({ kind: 'harvest', url: PDP })
    await untilFraming(router)
    await router.handle({ kind: 'framed', sessionId: 's1', cancelled: true })

    await expect(inFlight).resolves.toEqual({ ok: false, error: 'window_closed' })
    expect(router.sessionCount()).toBe(0)
  })

  it('gives up if nobody ever presses the button', async () => {
    const { router, log, timers } = build({ autoFrame: false })

    const inFlight = router.handle({ kind: 'harvest', url: PDP })
    await untilFraming(router)
    timers.fireAll()

    await expect(inFlight).resolves.toEqual({ ok: false, error: 'frame_timeout' })
    // No leaked popup, which is the failure mode a minutes-long wait invites.
    expect(log.windowsRemoved).toHaveLength(1)
    expect(router.sessionCount()).toBe(0)
    expect(router.pendingCount()).toBe(0)
  })

  it('shrugs off a second press after the studio already has its harvest', async () => {
    // The overlay stays mounted on purpose so the user can re-frame, so a
    // duplicate is a normal thing to see rather than an error.
    const { router } = build()
    const sessionId = await startSession(router)

    await expect(
      router.handle({ kind: 'framed', sessionId, harvest: HARVEST }),
    ).resolves.toEqual({ ok: true })
  })

  it('holds the worker open while the user is still framing', async () => {
    // A five-minute wait is many times MV3's ~30 s idle termination, and losing
    // the worker mid-frame would strand both the popup and the studio.
    const { router, keepAlive } = build({ autoFrame: false })
    void router.handle({ kind: 'harvest', url: PDP })
    await untilFraming(router)

    expect(keepAlive.at(-1)).toBe(true)
    expect(router.sessionCount()).toBe(1)
  })
})

describe('resolve — the window, not the session', () => {
  it('dismiss closes the window but keeps the session usable', async () => {
    const { router, log } = build()
    const sessionId = await startSession(router)

    await router.handle({ kind: 'resolve', sessionId, action: 'dismiss' })

    expect(log.windowsRemoved).toHaveLength(1)
    // The pick — and therefore the byte fetch — happens AFTER this.
    expect(router.sessionCount()).toBe(1)
    await expect(router.handle({ kind: 'fetchBytes', sessionId, url: IMG })).resolves.toMatchObject({
      ok: true,
    })
  })

  it('surface focuses the window and explains itself, without closing it', async () => {
    const { router, log } = build()
    const sessionId = await startSession(router)

    await router.handle({ kind: 'resolve', sessionId, action: 'surface' })

    expect(log.windowsRemoved).toEqual([])
    expect(log.windowsUpdated[0]?.opts).toMatchObject({ focused: true })
    const banner = String(log.scripts.at(-1)!.func)
    expect(banner).toContain('Hent billeder')
  })

  it('is idempotent on a session that is already gone', async () => {
    const { router } = build()
    await expect(
      router.handle({ kind: 'resolve', sessionId: 'never-existed', action: 'dismiss' }),
    ).resolves.toEqual({ ok: true })
  })

  it('closes the tab when the fallback was a tab', async () => {
    const { router, log } = build({ windowCreateFailures: 2 })
    const sessionId = await startSession(router)

    await router.handle({ kind: 'resolve', sessionId, action: 'dismiss' })

    expect(log.tabsRemoved).toContain(log.captureTabId)
    expect(log.windowsRemoved).toEqual([])
  })
})

describe('fetchBytes', () => {
  it('returns base64 and the content type', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    const { router } = build({}, fakeFetch(bytes, { type: 'image/webp' }) as unknown as typeof fetch)
    const sessionId = await startSession(router)

    const reply = (await router.handle({ kind: 'fetchBytes', sessionId, url: IMG })) as {
      ok: true
      base64: string
      mimeType: string
    }

    expect(reply.ok).toBe(true)
    expect(reply.mimeType).toBe('image/webp')
    expect(atob(reply.base64)).toBe('\xff\xd8\xff\xe0')
  })

  it('refuses an unknown session', async () => {
    const { router } = build()
    await expect(
      router.handle({ kind: 'fetchBytes', sessionId: 'bogus', url: IMG }),
    ).resolves.toEqual({ ok: false, error: 'no_session' })
  })

  it('refuses a non-https URL even from a valid session', async () => {
    const { router } = build()
    const sessionId = await startSession(router)
    await expect(
      router.handle({ kind: 'fetchBytes', sessionId, url: 'http://image.test/a.jpg' }),
    ).resolves.toEqual({ ok: false, error: 'bad_url' })
  })

  it('surfaces an HTTP failure with its status', async () => {
    const { router } = build(
      {},
      fakeFetch(new Uint8Array([1]), { ok: false, status: 403 }) as unknown as typeof fetch,
    )
    const sessionId = await startSession(router)

    const reply = await router.handle({ kind: 'fetchBytes', sessionId, url: IMG })
    expect(reply).toEqual({ ok: false, error: 'fetch_failed:HTTP 403' })
  })

  it('rejects an empty body', async () => {
    const { router } = build({}, fakeFetch(new Uint8Array(0)) as unknown as typeof fetch)
    const sessionId = await startSession(router)
    await expect(router.handle({ kind: 'fetchBytes', sessionId, url: IMG })).resolves.toEqual({
      ok: false,
      error: 'fetch_failed:empty',
    })
  })

  it('rejects a body the cutout endpoint would reject anyway', async () => {
    const huge = new Uint8Array(21 * 1024 * 1024)
    const { router } = build({}, fakeFetch(huge) as unknown as typeof fetch)
    const sessionId = await startSession(router)
    await expect(router.handle({ kind: 'fetchBytes', sessionId, url: IMG })).resolves.toEqual({
      ok: false,
      error: 'too_large',
    })
  })
})

describe('session TTL', () => {
  it('expires the session and dismisses a window still open', async () => {
    const { router, log, timers } = build()
    await router.handle({ kind: 'harvest', url: PDP })
    expect(timers.handles()).toHaveLength(1)

    timers.fireAll()
    await Promise.resolve()

    expect(router.sessionCount()).toBe(0)
    // The valve: a page crash or a mid-capture navigation cannot leak a popup.
    expect(log.windowsRemoved).toHaveLength(1)
  })

  it('is re-armed by every fetchBytes', async () => {
    const { router, timers } = build()
    const sessionId = await startSession(router)
    const before = timers.handles()

    await router.handle({ kind: 'fetchBytes', sessionId, url: IMG })
    const after = timers.handles()

    expect(after).toHaveLength(1)
    expect(after).not.toEqual(before) // the old deadline was cancelled
  })

  it('holds the worker open for exactly as long as a session lives', async () => {
    // Without this, MV3 idle-terminates the worker after ~30 s and the user's pick
    // lands on a session — and a TTL timer — that no longer exists.
    const { router, timers, keepAlive } = build()
    await startSession(router)
    expect(keepAlive).toEqual([true])

    timers.fireAll()
    await Promise.resolve()

    expect(keepAlive.at(-1)).toBe(false)
  })

  it('does not try to close a window that resolve already closed', async () => {
    const { router, log, timers } = build()
    const sessionId = await startSession(router)
    await router.handle({ kind: 'resolve', sessionId, action: 'dismiss' })

    timers.fireAll()
    await Promise.resolve()

    expect(log.windowsRemoved).toHaveLength(1)
    expect(router.sessionCount()).toBe(0)
  })
})

/**
 * The window between the popup opening and the viewfinder appearing.
 *
 * The retailer page loads, a consent wall is dismissed, and the overlay mounts —
 * seconds, on a real page. Everything the user could see in that time is a shop
 * page with no viewfinder over it, which reads as a window that opened and did
 * nothing. So the popup stays covered until the viewfinder itself takes the
 * cover down.
 */
describe('opening the popup', () => {
  it('opens the window on our own page, not on the retailer', async () => {
    const { router, log } = build()
    await startSession(router)

    expect(log.windowsCreated[0]!.url).toBe(LOADING_PAGE)
  })

  it('loads the retailer in its own hidden tab, never in the visible one', async () => {
    // The visible tab is never navigated, which is the whole point: a
    // navigation is the one moment nothing can be painted, and Firefox holds
    // the previous pixels only for same-origin ones.
    const { router, log } = build()
    await startSession(router)

    expect(log.tabsCreated).toContainEqual({ windowId: 100, active: false })
    expect(navigations(log)).toEqual([{ tabId: log.captureTabId, opts: { url: PDP } }])
    expect(log.captureTabId).not.toBe(log.tabIds[0])
  })

  it('shows the retailer tab and closes the loading one when the bundle reports in', async () => {
    const { router, log } = build()
    await startSession(router)

    expect(log.tabsUpdated).toContainEqual({
      tabId: log.captureTabId,
      opts: { active: true },
    })
    expect(log.tabsRemoved).toContain(log.tabIds[0])
  })

  it('waits for our page to be on screen before starting the retailer', async () => {
    // The bug this exists to stop: `windows.create` resolves when the WINDOW
    // exists, not when its tab has loaded or painted. Navigating on the next
    // line hands the retailer a window the loading page never reached — so the
    // user watches the shop load, exactly as they did before the page existed.
    const { router, log, updateTab } = build({
      popupStartsLoading: true,
      loadingPageTimeoutMs: 5_000,
    })
    void router.handle({ kind: 'harvest', url: PDP })
    await settleMicrotasks()

    expect(log.tabsCreated).toEqual([])

    updateTab(log.tabIds[0]!, 'complete')
    await settleMicrotasks()

    expect(navigations(log)).toEqual([{ tabId: log.captureTabId, opts: { url: PDP } }])
  })

  it('gives up waiting rather than stranding the capture on our own page', async () => {
    // A loading page that never reports complete must not hold the capture
    // forever. It is read from disk, so the budget is short and going on
    // without it beats hanging.
    const { router, log, timers } = build({ popupStartsLoading: true, loadingPageTimeoutMs: 5_000 })
    void router.handle({ kind: 'harvest', url: PDP })
    await settleMicrotasks()
    expect(log.tabsCreated).toEqual([])

    timers.fireAll()
    await settleMicrotasks()

    expect(navigations(log)).toEqual([{ tabId: log.captureTabId, opts: { url: PDP } }])
  })

  it('opens the fallback tab on our own page too', async () => {
    // Every popup attempt failing drops to a plain tab. It is the same window to
    // the user, so it gets the same first paint.
    const { router, log } = build({ windowCreateFailures: 3 })
    await startSession(router)

    expect(log.tabsCreated[0]!.url).toBe(LOADING_PAGE)
    expect(navigations(log)).toEqual([{ tabId: log.captureTabId, opts: { url: PDP } }])
  })

  it('gives up the capture when the retailer has nowhere to load', async () => {
    // A popup stuck on our loading page has nothing to harvest. Failing here is
    // what stops it being discovered as an empty harvest of our own spinner.
    const { router, log } = build({ captureTabFails: true })
    const reply = await router.handle({ kind: 'harvest', url: PDP })

    expect(reply.ok).toBe(false)
    expect(log.windowsRemoved.length + log.tabsRemoved.length).toBeGreaterThan(0)
  })
})

/**
 * The registration that replaced the injection race.
 *
 * The bundle used to be pushed in with `executeScript` after the load wait and
 * the settle, then armed with a second call. It is registered for the
 * retailer's origin at `document_start` instead, so the browser runs it before
 * each document paints — the first one, and every one a redirect or a reload
 * produces.
 */
describe('the document_start registration', () => {
  it('registers the bundle for the retailer origin before navigating there', async () => {
    const { router, log } = build()
    await startSession(router)

    expect(log.registered).toHaveLength(1)
    expect(log.registered[0]).toMatchObject({
      js: ['injected.js'],
      matches: ['https://www2.hm.com/*'],
      runAt: 'document_start',
    })
  })

  it('does not let the registration outlive the browser session', async () => {
    // `persistAcrossSessions` defaults to TRUE. Left at the default, one capture
    // would keep running this bundle on that shop, in every tab and every
    // window, until the browser restarts.
    const { router, log } = build()
    await startSession(router)

    expect(log.registered[0]!.persistAcrossSessions).toBe(false)
  })

  it('registers before the navigation, not after it', async () => {
    // The other order is the old bug in a new coat: the document would be on
    // its way before anything was registered to cover it.
    const { router, log } = build()
    await startSession(router)

    expect(log.registered).toHaveLength(1)
    expect(navigations(log)).toHaveLength(1)
  })

  it('answers the bundle with the session that owns its tab', async () => {
    const { router, log, armed } = build()
    const sessionId = await startSession(router)

    // `armed` is filled by the fake going through the real `ready` path.
    expect(armed).toEqual([sessionId])
    expect(log.registered[0]!.id).toContain(sessionId)
  })

  it('tells a tab with no capture to stand down', async () => {
    // The registration matches an origin, so it also runs in whatever other
    // tabs the user has open on that shop. They must be told to take their
    // cover off, not left wearing it.
    const { router } = build()
    await startSession(router)

    const reply = await router.handle({ kind: 'ready' }, { tab: { id: 9999 } })

    expect(reply.ok).toBe(false)
  })

  it('tells a sender with no tab at all to stand down', async () => {
    const { router } = build()
    await startSession(router)

    expect((await router.handle({ kind: 'ready' })).ok).toBe(false)
  })

  it('unregisters when the window closes, not when the harvest returns', async () => {
    // The window outliving the harvest is the point: on an empty ranking the
    // studio surfaces it again and the user re-frames, and until it is gone a
    // navigation still needs to re-arm the viewfinder.
    const { router, log } = build()
    const sessionId = await startSession(router)

    expect(log.unregistered).toEqual([])

    await router.handle({ kind: 'resolve', sessionId, action: 'dismiss' })

    expect(log.unregistered).toEqual([`dripd-capture-${sessionId}`])
  })

  it('unregisters when a capture fails', async () => {
    const { router, log } = build({ captureTabFails: true })
    await router.handle({ kind: 'harvest', url: PDP })

    expect(log.unregistered).toHaveLength(1)
  })

  it('gives up the capture when the bundle cannot be registered', async () => {
    // Navigating anyway would put the user on a shop page with no cover and no
    // viewfinder, and nothing on the way to give them one.
    const { router, log } = build({ registerFails: true })
    const reply = await router.handle({ kind: 'harvest', url: PDP })

    expect(reply.ok).toBe(false)
    expect(log.tabsCreated).toEqual([])
  })
})
