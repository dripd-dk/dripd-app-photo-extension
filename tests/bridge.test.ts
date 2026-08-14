/**
 * The bridge tested against a REAL window.
 *
 * This is deliberate. A hand-rolled fake window that does not echo a
 * `postMessage` back to its own listeners is what let the page side ship
 * completely non-functional with thirteen green tests: `window.postMessage`
 * delivers the event to *that same window's* listeners, so without the `dir`
 * discriminator a request is consumed by the listener awaiting its reply.
 *
 * One fidelity gap to know about: **happy-dom does not populate
 * `MessageEvent.source`** — a real browser sets it to the posting window, happy-dom
 * leaves an unrelated EventTarget there. So inbound requests are dispatched
 * explicitly with `source: window`, or every test here would pass vacuously on the
 * source check and never reach the logic it claims to cover. Replies still travel
 * through the genuine `win.postMessage`, so the echo behaviour is real.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { announce, installBridge } from '../src/bridge'

const ORIGIN = () => window.location.origin

/** An inbound message as a browser would deliver it: same window, same origin. */
function deliver(
  data: unknown,
  opts: { origin?: string; source?: Window | null } = {},
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data,
      origin: opts.origin ?? ORIGIN(),
      source: 'source' in opts ? opts.source : window,
    }),
  )
}

function collectMessages(): { seen: Record<string, unknown>[]; stop: () => void } {
  const seen: Record<string, unknown>[] = []
  const listener = (e: MessageEvent) => {
    if (e.data && typeof e.data === 'object') seen.push(e.data as Record<string, unknown>)
  }
  window.addEventListener('message', listener)
  return { seen, stop: () => window.removeEventListener('message', listener) }
}

/** A reply is two hops out: `send`'s promise settles, then postMessage delivers. */
async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setTimeout(r, 0))
}

let uninstall: (() => void) | null = null

afterEach(() => {
  uninstall?.()
  uninstall = null
  vi.restoreAllMocks()
})

describe('installBridge', () => {
  it('relays a request and posts the reply back as dir:res', async () => {
    const send = vi.fn((_msg: unknown) => Promise.resolve({ ok: true, version: '0.1.0' }))
    uninstall = installBridge({ win: window, send })
    const { seen, stop } = collectMessages()

    deliver({ __dripd: true, dir: 'req', kind: 'ping', nonce: 'n1' })
    await flush()
    stop()

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toMatchObject({ kind: 'ping', nonce: 'n1' })
    expect(seen).toEqual(
      expect.arrayContaining([
        { __dripd: true, dir: 'res', nonce: 'n1', ok: true, version: '0.1.0' },
      ]),
    )
  })

  it('never relays its own reply, even though the window echoes it back', async () => {
    // The reply below goes out through the real postMessage and lands right back in
    // the bridge's own listener. Without the dir check this loops: the reply gets
    // forwarded to the background as if it were a fresh request.
    const send = vi.fn(() => Promise.resolve({ ok: true }))
    uninstall = installBridge({ win: window, send })

    deliver({ __dripd: true, dir: 'req', kind: 'ping', nonce: 'n2' })
    await flush()

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('ignores a reply delivered as though it were a request', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true }))
    uninstall = installBridge({ win: window, send })

    deliver({ __dripd: true, dir: 'res', nonce: 'n', ok: true })
    await flush()

    expect(send).not.toHaveBeenCalled()
  })

  it('ignores messages that are not ours', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true }))
    uninstall = installBridge({ win: window, send })

    deliver({ dir: 'req', kind: 'ping' }) // no marker
    deliver({ __dripd: true, kind: 'ping' }) // no direction
    deliver('a string')
    deliver(null)
    await flush()

    expect(send).not.toHaveBeenCalled()
  })

  it('ignores a message from another window, such as an embedded iframe', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true }))
    uninstall = installBridge({ win: window, send })

    // The bridge is a CORS-bypass proxy; an iframe on a dripd page must not drive it.
    deliver(
      { __dripd: true, dir: 'req', kind: 'harvest', url: 'https://evil.test', nonce: 'x' },
      { source: null },
    )
    await flush()

    expect(send).not.toHaveBeenCalled()
  })

  it('ignores a cross-origin message', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true }))
    uninstall = installBridge({ win: window, send })

    deliver({ __dripd: true, dir: 'req', kind: 'ping', nonce: 'y' }, { origin: 'https://evil.test' })
    await flush()

    expect(send).not.toHaveBeenCalled()
  })

  it('reports a background failure instead of letting the page time out', async () => {
    const send = vi.fn(() => Promise.reject(new Error('Receiving end does not exist')))
    uninstall = installBridge({ win: window, send })
    const { seen, stop } = collectMessages()

    deliver({ __dripd: true, dir: 'req', kind: 'harvest', nonce: 'n3' })
    await flush()
    stop()

    expect(seen).toEqual(
      expect.arrayContaining([
        { __dripd: true, dir: 'res', nonce: 'n3', ok: false, error: 'Receiving end does not exist' },
      ]),
    )
  })

  it('reports a silent background rather than waiting 45 seconds for nothing', async () => {
    const send = vi.fn(() => Promise.resolve(undefined))
    uninstall = installBridge({ win: window, send })
    const { seen, stop } = collectMessages()

    deliver({ __dripd: true, dir: 'req', kind: 'ping', nonce: 'n4' })
    await flush()
    stop()

    expect(seen).toEqual(
      expect.arrayContaining([
        { __dripd: true, dir: 'res', nonce: 'n4', ok: false, error: 'no_reply' },
      ]),
    )
  })

  it('stops relaying once uninstalled', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true }))
    const stopBridge = installBridge({ win: window, send })
    stopBridge()

    deliver({ __dripd: true, dir: 'req', kind: 'ping', nonce: 'n5' })
    await flush()

    expect(send).not.toHaveBeenCalled()
  })
})

describe('announce', () => {
  it('carries no nonce, so it settles nothing on the page', async () => {
    const { seen, stop } = collectMessages()
    announce(window, '0.1.0')
    await flush()
    stop()

    const ready = seen.find((m) => m.kind === 'ready')
    expect(ready).toMatchObject({ __dripd: true, dir: 'res', version: '0.1.0' })
    expect(ready).not.toHaveProperty('nonce')
  })
})
