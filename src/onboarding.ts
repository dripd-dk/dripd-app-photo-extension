/**
 * The one-time grant page.
 *
 * It exists because `permissions.request` needs a user gesture and a click
 * relayed from the dripd page to the background carries none. The button here is
 * a real gesture in the extension's own context.
 *
 * ## Safari does not work this way at all
 *
 * Safari manages host access through its own Settings → Extensions panel, per
 * site. `permissions.request()` for origins produces no prompt there — the button
 * appears to do nothing, and the page sat on "Afventer din browser…" forever
 * waiting for a decision that was never going to be asked for.
 *
 * So on Safari the button is replaced by the actual instructions, and the page
 * watches for the grant instead of asking for it: the moment access appears, it
 * says so, without the user having to come back and press anything.
 */

import { api } from './browser'
import { hasHostAccess, requestHostAccess } from './permissions'

const button = document.getElementById('grant') as HTMLButtonElement | null
const decline = document.getElementById('decline') as HTMLButtonElement | null
const status = document.getElementById('status')
const safariHelp = document.getElementById('safari-help')

/** Safari's user agent claims neither Chrome nor Firefox; every Chromium one
 *  claims Safari, so the negative test is the reliable one. */
function isSafari(): boolean {
  const ua = navigator.userAgent
  return /\bSafari\//.test(ua) && !/\bChrom(e|ium)\/|\bFirefox\/|\bEdg\//.test(ua)
}

/** How long to wait for a browser that may never answer. */
const REQUEST_TIMEOUT_MS = 20_000
const POLL_MS = 1_500

function show(text: string, state?: 'granted'): void {
  if (!status) return
  status.textContent = text
  if (state) status.dataset.state = state
  else delete status.dataset.state
}

let granted = false

function markGranted(): void {
  if (granted) return
  granted = true
  show('Adgang givet. Du kan lukke denne fane og gå tilbage til dripd.', 'granted')
  if (button) {
    button.disabled = true
    button.textContent = 'Adgang givet'
  }
  if (safariHelp) safariHelp.hidden = true
}

/** Show Safari what to do, since it will not be asked. */
function showSafariHelp(): void {
  if (safariHelp) safariHelp.hidden = false
  if (button) button.hidden = true
  show('Følg trinnene ovenfor — siden opdager selv, når adgangen er givet.')
}

/**
 * Watch for the grant rather than requiring another click.
 *
 * On Safari the user leaves this page entirely, grants access in Settings, and
 * comes back; on every browser a permission can also be revoked from settings
 * behind our back. Polling `permissions.contains` is the only way to reflect
 * either — there is no event for it, and a stored flag would be a lie the moment
 * someone changed their mind.
 */
function watchForGrant(): void {
  const timer = setInterval(async () => {
    if (granted) {
      clearInterval(timer)
      return
    }
    if (await hasHostAccess(api)) {
      clearInterval(timer)
      markGranted()
    }
  }, POLL_MS)
}

async function init(): Promise<void> {
  if (await hasHostAccess(api)) {
    markGranted()
    return
  }
  if (isSafari()) showSafariHelp()
  watchForGrant()
}

button?.addEventListener('click', async () => {
  show('Afventer din browser…')
  // Bounded: a browser that shows no prompt also never answers, and an
  // indefinite "waiting for your browser" is indistinguishable from a hang.
  const answered = await Promise.race([
    requestHostAccess(api),
    new Promise<null>((r) => setTimeout(() => r(null), REQUEST_TIMEOUT_MS)),
  ])

  if (answered === true) {
    markGranted()
    return
  }
  if (await hasHostAccess(api)) {
    markGranted()
    return
  }
  // `null` means the browser never answered at all, which is what Safari does.
  if (answered === null || isSafari()) showSafariHelp()
  else show('Adgang blev ikke givet. Tryk igen, hvis du vil bruge billed-hentning.')
})

/**
 * "Nej tak — fjern udvidelsen", taken literally.
 *
 * `management.uninstallSelf` is available to every extension without declaring
 * the `management` permission, precisely because it can only ever remove the
 * caller. `showConfirmDialog` leaves the actual decision with the browser's own
 * prompt rather than this page, so the button cannot uninstall anything by
 * itself. Where it does not exist, closing the tab is the honest fallback — the
 * footnote already says removal lives in Chrome's own settings.
 */
decline?.addEventListener('click', async () => {
  const management = (api as { management?: { uninstallSelf?: (o: unknown) => Promise<void> } })
    .management
  try {
    if (management?.uninstallSelf) {
      await management.uninstallSelf({ showConfirmDialog: true })
      return
    }
  } catch {
    /* the user said no in the browser's dialog — leave the page as it was */
    return
  }
  show('Du kan fjerne udvidelsen under Udvidelser i din browser.')
})

void init()
