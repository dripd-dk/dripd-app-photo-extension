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

void init()
