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

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Anything not ours belongs to someone else — say nothing and let another
  // listener answer.
  if (!msg || (msg as Record<string, unknown>)[MARKER] !== true) return undefined

  // `sender` matters for exactly one message: the bundle asking whether its tab
  // is a capture. It runs on every tab of the retailer's origin and cannot tell
  // from the page which one it is in.
  router
    .handle(msg, sender)
    .then(sendResponse)
    .catch((e: unknown) => sendResponse({ ok: false, error: String(e) }))

  // Keeps the message channel open for the async reply. Returning a promise
  // instead works in Firefox and silently does nothing in Chromium.
  return true
})

/**
 * The toolbar button opens the grant page.
 *
 * Without this there is a dead end on Safari: host access has to be granted
 * before the content script runs, the content script is what lets the studio see
 * the extension, and the studio is what opens this page. The user is told to
 * install something that is already installed, with no way to reach the
 * instructions. A toolbar button is the one entry point that always works.
 *
 * `onClicked` only fires when no `default_popup` is declared, which is why the
 * manifest declares none.
 */
api.action?.onClicked?.addListener(() => {
  void api.tabs.create({ url: api.runtime.getURL('onboarding.html'), active: true })
})

console.log('[dripd] background ready', VERSION)
