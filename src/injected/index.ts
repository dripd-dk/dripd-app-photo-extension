/**
 * Entry point for the bundle injected into the retailer page.
 *
 * Injected with `scripting.executeScript({ files: ['injected.js'] })`, which runs
 * it in the extension's isolated world — same DOM, no access to the page's JS
 * globals, and no CORS involved because nothing here fetches anything.
 *
 * It installs `globalThis.__dripdHarvest` rather than harvesting on load, so the
 * background can inject once and call it. The call itself goes through a second,
 * one-line `executeScript({ func })` — that function is serialized by the browser
 * and therefore has to be self-contained, which is exactly why the real work
 * lives here as ordinary importable modules instead of inside it.
 */

import type { RawHarvest } from '../protocol'
import { dismissConsent } from './consent'
import { harvestGallery } from './gallery'

/** Time for a dismissed cookie wall to unmount and the gallery to lay out. */
const CONSENT_SETTLE_MS = 400

export interface RunResult extends RawHarvest {
  /** Diagnostics, logged by the background. The page ignores them, but "5 of 6
   *  images, zero advances, no strategy worked" is the difference between a
   *  fixable report and a shrug. */
  meta: {
    version: number
    consentDismissed: boolean
    advances: number
    strategies: string[]
    gained: number
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function run(): Promise<RunResult> {
  // Rejecting a cookie wall is not collecting photos, and it never accepts.
  const consentDismissed = dismissConsent(document)
  if (consentDismissed) await delay(CONSENT_SETTLE_MS)

  const result = await harvestGallery()

  return {
    ...result.harvest,
    meta: {
      version: 1,
      consentDismissed,
      advances: result.advances,
      strategies: result.strategies,
      gained: result.gained,
    },
  }
}

interface InjectedGlobal {
  __dripdHarvest?: { run: () => Promise<RunResult> }
}

const g = globalThis as unknown as InjectedGlobal

// Idempotent: the background may inject twice if a session is retried in the
// same tab, and re-running the module must not replace a harvest in flight.
if (!g.__dripdHarvest) g.__dripdHarvest = { run }
