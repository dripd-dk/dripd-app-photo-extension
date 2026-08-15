/**
 * Content script on dripd's origin. Wiring only — the checks and the relay live in
 * `bridge.ts` so they can be tested against a real window.
 */

import { api, VERSION } from './browser'
import { announce, installBridge } from './bridge'

/** Dev builds rename themselves; production stays silent on the page. */
const isDev = (() => {
  try {
    return /\(dev\)/.test(api.runtime.getManifest().name)
  } catch {
    return false
  }
})()

const log = isDev
  ? (...args: unknown[]) => console.log('[dripd bridge]', ...args)
  : undefined

installBridge({
  win: window,
  send: (msg) => api.runtime.sendMessage(msg),
  version: VERSION,
  log,
})

// Proves the content script is on the page at all, which is otherwise
// indistinguishable from an extension that is not installed.
log?.('installed on', window.location.href, 'version', VERSION)

announce(window, VERSION)
