/**
 * Host access, asked for once.
 *
 * The all-https host pattern (see `ORIGINS` below — spelling it in a block comment
 * would close the comment) is declared **optional**, not required, so installing the
 * extension prompts for nothing and the ask arrives in context — on dripd, when
 * the user is about to capture something.
 *
 * There is deliberately no `storage` permission and no "onboarded" flag.
 * `permissions.contains` answers the question directly, and a stored flag would
 * desync the moment someone revokes access in browser settings, leaving the
 * extension convinced it still had permission.
 *
 * `permissions.request` requires a user gesture, and a click relayed from the
 * page to the background carries none (crbug.com/1284891). That single fact is
 * why an onboarding page exists at all.
 */

const ORIGINS = ['https://*/*']

interface PermissionsApi {
  permissions: {
    contains(p: { origins: string[] }): Promise<boolean>
    request(p: { origins: string[] }): Promise<boolean>
  }
}

export async function hasHostAccess(api: PermissionsApi): Promise<boolean> {
  try {
    return await api.permissions.contains({ origins: ORIGINS })
  } catch {
    return false
  }
}

/** Must be called from a real user gesture — i.e. a click handler on our own page. */
export async function requestHostAccess(api: PermissionsApi): Promise<boolean> {
  try {
    return await api.permissions.request({ origins: ORIGINS })
  } catch {
    return false
  }
}
