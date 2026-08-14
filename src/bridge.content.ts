/**
 * Content script on dripd's origin. Wiring only — the checks and the relay live in
 * `bridge.ts` so they can be tested against a real window.
 */

import { api, VERSION } from './browser'
import { announce, installBridge } from './bridge'

installBridge({
  win: window,
  send: (msg) => api.runtime.sendMessage(msg),
  version: VERSION,
})

announce(window, VERSION)
