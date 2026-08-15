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
  executeScriptError?: string
  /** Leave the viewfinder up instead of pressing the button, so a test can drive
   *  the ways a framing session ends without one. */
  autoFrame?: boolean
  /** Safari resolves `windows.create` without the documented `tabs` array. */
  omitCreatedTabs?: boolean
}

function fakeApi(opts: FakeOptions = {}) {
  const granted = opts.granted ?? true
  let windowFailures = opts.windowCreateFailures ?? 0
  let nextId = 100
  const closeListeners: ((tabId: number) => void)[] = []
  const windowTabs = new Map<number, number>()
  let onArm: ((sessionId: string) => void) | null = null

  const log = {
    windowsCreated: [] as Record<string, unknown>[],
    windowsRemoved: [] as number[],
    windowsUpdated: [] as { id: number; opts: Record<string, unknown> }[],
    tabsCreated: [] as Record<string, unknown>[],
    tabsRemoved: [] as number[],
    scripts: [] as Record<string, unknown>[],
    /** Whatever the popup ended up being, window or fallback tab. */
    tabIds: [] as number[],
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
        const id = nextId++
        // The onboarding tab is not a popup; the fallback tab is, and both are
        // now created active, so the URL is what tells them apart.
        if (!String(options.url ?? '').includes('onboarding')) log.tabIds.push(id)
        return Promise.resolve({ id })
      },
      get: () => Promise.resolve({ status: 'complete' }),
      query: (info) => {
        const id = (info as { windowId?: number }).windowId
        const tabId = id == null ? undefined : windowTabs.get(id)
        return Promise.resolve(tabId == null ? [] : [{ id: tabId }])
      },
      remove(id) {
        log.tabsRemoved.push(id)
        return Promise.resolve()
      },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
      onRemoved: { addListener: (fn) => closeListeners.push(fn) },
    },
    scripting: {
      executeScript(options) {
        log.scripts.push(options)
        if (opts.executeScriptError) return Promise.reject(new Error(opts.executeScriptError))
        // Arming carries the session id in `args`; that is the call a real user
        // would answer by pressing the button, so it is where the fake presses it.
        const args = options.args as unknown[] | undefined
        const sessionId = typeof args?.[0] === 'string' ? args[0] : null
        if (sessionId) queueMicrotask(() => onArm?.(sessionId))
        return Promise.resolve([{}])
      },
    },
  }

  return {
    api,
    log,
    /** The user closing the popup. */
    closeTab: (tabId: number) => closeListeners.forEach((fn) => fn(tabId)),
    setOnArm: (fn: (sessionId: string) => void) => {
      onArm = fn
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
  const { api, log, closeTab, setOnArm } = fakeApi(opts)
  // Kept off the timer seam on purpose: a 20 s heartbeat sharing `schedule` would
  // show up in every TTL assertion in this file.
  const keepAlive: boolean[] = []
  let n = 0
  const router = createRouter({
    api,
    fetchImpl: fetchImpl ?? (fakeFetch(new Uint8Array([1, 2, 3])) as unknown as typeof fetch),
    version: '0.1.0',
    ttlMs: 60_000,
    loadTimeoutMs: 10,
    settleMs: 10,
    newId: () => `s${++n}`,
    schedule: timers.schedule,
    cancel: timers.cancel,
    keepAlive: (active) => keepAlive.push(active),
  })
  // Most tests care about what happens once a photo has been framed, so the
  // default fake presses the button the moment the viewfinder is armed.
  if (opts.autoFrame !== false) {
    setOnArm((sessionId) => {
      void router.handle({
        kind: 'framed',
        sessionId,
        harvest: opts.harvestResult ?? HARVEST,
      })
    })
  }
  return { router, log, timers, keepAlive, closeTab }
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
    expect(log.windowsCreated[0]).toMatchObject({ type: 'popup', focused: true, url: PDP })
    // The page has not ranked yet — closing here would leave nothing to recover with.
    expect(log.windowsRemoved).toEqual([])
    expect(router.sessionCount()).toBe(1)
  })

  it('injects the bundle first, then arms it with the session id', async () => {
    const { router, log } = build()
    await router.handle({ kind: 'harvest', url: PDP })

    expect(log.scripts[0]).toMatchObject({ files: ['injected.js'] })
    expect(typeof log.scripts[1]!.func).toBe('function')
    // The overlay names its own session when it reports back, rather than the
    // background inferring one from the sender's tab.
    expect(log.scripts[1]!.args).toEqual(['s1'])
  })

  it('injects an arm call that survives serialization', () => {
    // The browser serializes `func` with toString(), so a reference to anything
    // outside the function body would arrive undefined. Re-evaluating the source
    // in a fresh scope is the same trip, and proves it.
    const { router, log } = build()
    return router.handle({ kind: 'harvest', url: PDP }).then(() => {
      const source = String(log.scripts[1]!.func)
      const revived = new Function(`return (${source})`)() as (id: string) => unknown
      ;(globalThis as unknown as { __dripdHarvest: unknown }).__dripdHarvest = {
        arm: (id: string) => `armed:${id}`,
      }
      expect(revived('s1')).toBe('armed:s1')
    })
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
    // third fallback tab, which is where the injection went, which is why no
    // viewfinder ever appeared on the retailer's page.
    const { router, log } = build({ omitCreatedTabs: true })

    const reply = await router.handle({ kind: 'harvest', url: PDP })

    expect(reply).toMatchObject({ ok: true })
    expect(log.windowsCreated).toHaveLength(1)
    expect(log.tabsCreated).toEqual([])
    expect(log.windowsRemoved).toEqual([])
    // And the tab it injects into is the one that window actually owns.
    expect(log.scripts[0]).toMatchObject({ target: { tabId: log.tabIds[0] } })
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

  it('closes the window and keeps no session when injection fails', async () => {
    const { router, log } = build({ executeScriptError: 'Cannot access contents of the page' })

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
    closeTab(log.tabIds[0]!)

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

    expect(log.tabsRemoved).toHaveLength(1)
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
