/**
 * The one-time grant page.
 *
 * It exists because `permissions.request` needs a user gesture and a click
 * relayed from the dripd page to the background carries none. The button here is
 * a real gesture in the extension's own context.
 */

import { api } from './browser'
import { hasHostAccess, requestHostAccess } from './permissions'

const button = document.getElementById('grant') as HTMLButtonElement | null
const decline = document.getElementById('decline') as HTMLButtonElement | null
const status = document.getElementById('status')

function show(text: string, state?: 'granted'): void {
  if (!status) return
  status.textContent = text
  if (state) status.dataset.state = state
  else delete status.dataset.state
}

function markGranted(): void {
  show('Adgang givet. Du kan lukke denne fane og gå tilbage til dripd.', 'granted')
  if (button) {
    button.disabled = true
    button.textContent = 'Adgang givet'
  }
}

async function init(): Promise<void> {
  if (await hasHostAccess(api)) markGranted()
}

button?.addEventListener('click', async () => {
  show('Afventer din browser…')
  const granted = await requestHostAccess(api)
  if (granted) markGranted()
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
