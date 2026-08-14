/**
 * Background entry point. Wiring only — the logic is in `router.ts`, where it can
 * be tested without a browser.
 *
 * One file serves as both Chromium's `service_worker` and Firefox's
 * `background.scripts` entry, which is why the build emits a classic IIFE and the
 * manifest declares no `"type": "module"`.
 */

import { api, VERSION } from './browser'
import { createRouter, type BrowserLike } from './router'
import { MARKER } from './protocol'

const router = createRouter({
  api: api as unknown as BrowserLike,
  version: VERSION,
  log: (...args) => console.log('[dripd]', ...args),
})

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Anything not ours belongs to someone else — say nothing and let another
  // listener answer.
  if (!msg || (msg as Record<string, unknown>)[MARKER] !== true) return undefined

  router
    .handle(msg)
    .then(sendResponse)
    .catch((e: unknown) => sendResponse({ ok: false, error: String(e) }))

  // Keeps the message channel open for the async reply. Returning a promise
  // instead works in Firefox and silently does nothing in Chromium.
  return true
})

console.log('[dripd] background ready', VERSION)
