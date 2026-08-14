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
}

function fakeApi(opts: FakeOptions = {}) {
  const granted = opts.granted ?? true
  let windowFailures = opts.windowCreateFailures ?? 0
  let nextId = 100

  const log = {
    windowsCreated: [] as Record<string, unknown>[],
    windowsRemoved: [] as number[],
    windowsUpdated: [] as { id: number; opts: Record<string, unknown> }[],
    tabsCreated: [] as Record<string, unknown>[],
    tabsRemoved: [] as number[],
    scripts: [] as Record<string, unknown>[],
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
        return Promise.resolve({ id, tabs: [{ id: nextId++ }] })
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
        return Promise.resolve({ id: nextId++ })
      },
      get: () => Promise.resolve({ status: 'complete' }),
      remove(id) {
        log.tabsRemoved.push(id)
        return Promise.resolve()
      },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },
    scripting: {
      executeScript(options) {
        log.scripts.push(options)
        if (opts.executeScriptError) return Promise.reject(new Error(opts.executeScriptError))
        // The `files` injection returns nothing; the `func` call returns the harvest.
        if (options.files) return Promise.resolve([{}])
        return Promise.resolve([{ result: opts.harvestResult ?? HARVEST }])
      },
    },
  }

  return { api, log }
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
  const { api, log } = fakeApi(opts)
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
  })
  return { router, log, timers }
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
  it('opens an unfocused popup and leaves it open', async () => {
    const { router, log } = build()

    const reply = await router.handle({ kind: 'harvest', url: PDP })

    expect(reply).toMatchObject({ ok: true, sessionId: 's1', harvest: HARVEST })
    expect(log.windowsCreated[0]).toMatchObject({ type: 'popup', focused: false, url: PDP })
    // The page has not ranked yet — closing here would leave nothing to recover with.
    expect(log.windowsRemoved).toEqual([])
    expect(router.sessionCount()).toBe(1)
  })

  it('injects the bundle first, then calls into it', async () => {
    const { router, log } = build()
    await router.handle({ kind: 'harvest', url: PDP })

    expect(log.scripts[0]).toMatchObject({ files: ['injected.js'] })
    expect(typeof log.scripts[1]!.func).toBe('function')
  })

  it('injects a runner that survives serialization', () => {
    // The browser serializes `func` with toString(), so a reference to anything
    // outside the function body would arrive undefined. Re-evaluating the source
    // in a fresh scope is the same trip, and proves it.
    const { router, log } = build()
    return router.handle({ kind: 'harvest', url: PDP }).then(() => {
      const source = String(log.scripts[1]!.func)
      const revived = new Function(`return (${source})`)() as () => unknown
      ;(globalThis as unknown as { __dripdHarvest: unknown }).__dripdHarvest = {
        run: () => 'called',
      }
      expect(revived()).toBe('called')
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

  it('falls back to a focused popup, then to a background tab', async () => {
    const one = build({ windowCreateFailures: 1 })
    await expect(one.router.handle({ kind: 'harvest', url: PDP })).resolves.toMatchObject({ ok: true })
    expect(one.log.windowsCreated).toHaveLength(2)
    expect(one.log.windowsCreated[1]).not.toHaveProperty('focused')

    const both = build({ windowCreateFailures: 2 })
    await expect(both.router.handle({ kind: 'harvest', url: PDP })).resolves.toMatchObject({ ok: true })
    expect(both.log.tabsCreated[0]).toMatchObject({ active: false })
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
    expect(banner).toContain('afvis cookies')
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
