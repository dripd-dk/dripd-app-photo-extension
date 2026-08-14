/**
 * The cross-browser API handle.
 *
 * No `webextension-polyfill`. Firefox exposes `browser.*` with native promises;
 * Chromium's MV3 `chrome.*` returns promises for everything this extension uses
 * (`scripting`, `windows`, `tabs`, `permissions`, `runtime.sendMessage`). A shim
 * two lines long covers the gap, and one fewer bundled dependency is one fewer
 * thing for a store reviewer to read.
 *
 * Two places deliberately do NOT use promises:
 *  - `runtime.onMessage` replies go through `sendResponse` + `return true`.
 *    Returning a promise from the listener works in Firefox and silently does
 *    nothing in Chromium; the callback form works in both.
 */

interface BrowserGlobals {
  browser?: typeof chrome
  chrome?: typeof chrome
}

const g = globalThis as unknown as BrowserGlobals

/** Firefox first — its `browser` namespace is the promise-native one. */
export const api: typeof chrome = (g.browser?.runtime ? g.browser : g.chrome) as typeof chrome

export const VERSION: string = (() => {
  try {
    return api.runtime.getManifest().version
  } catch {
    return '0.0.0'
  }
})()
