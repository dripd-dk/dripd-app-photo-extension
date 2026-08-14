/**
 * Cookie-wall handling: it only ever REJECTS.
 *
 * Ported from `dripd-mobile/src/features/studio/linkHarvest/harvestScript.ts`,
 * which in turn came from `image-extractor/src/imgrab/consent.py`. Proven against
 * a real H&M page on a real phone — and note which half does the work there:
 * **none of the six CSS selectors match H&M**, the text pass does. So the text
 * pass is not a fallback, it is the primary path, and shortening this to "just
 * use the well-known selectors" breaks the retailer we test against most.
 *
 * Never clicking "accept" is a product decision, not an oversight. Accepting
 * tracking on someone's behalf is not ours to do, and a rejected banner reveals
 * the gallery just as well.
 */

const CMP_SELECTORS = [
  '#onetrust-reject-all-handler',
  '#didomi-notice-disagree-button',
  '#CybotCookiebotDialogBodyButtonDecline',
  '[data-testid="uc-deny-all-button"]',
  '[data-testid="cookie-policy-manage-dialog-button-deny"]',
  '#onetrust-pc-btn-handler',
]

const CMP_TEXT = /(reject|decline|disagree|afvis|kun nødvendige|only necessary|nødvendige kun)/i

/** A label long enough to be prose is not a button label — it is the banner's
 *  body text, which often contains the word "afvis" describing the button. */
const MAX_LABEL_LENGTH = 40

function clickIn(doc: Document): boolean {
  for (const sel of CMP_SELECTORS) {
    try {
      const el = doc.querySelector<HTMLElement>(sel)
      if (el) {
        el.click()
        return true
      }
    } catch {
      /* an unsupported selector must not abort the cascade */
    }
  }

  try {
    const buttons = doc.querySelectorAll<HTMLElement>('button, a[role="button"], [role="button"]')
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim()
      if (text && text.length < MAX_LABEL_LENGTH && CMP_TEXT.test(text)) {
        btn.click()
        return true
      }
    }
  } catch {
    /* ignore */
  }

  return false
}

/**
 * Dismiss a consent banner in this document or any same-origin iframe.
 *
 * A cross-origin CMP frame is unreachable by design; that case is why the studio
 * still offers "afvis cookies og prøv igen" with the window surfaced.
 */
export function dismissConsent(doc: Document = document): boolean {
  if (clickIn(doc)) return true

  const frames = doc.querySelectorAll('iframe')
  for (const frame of frames) {
    try {
      const inner = frame.contentDocument
      if (inner && clickIn(inner)) return true
    } catch {
      /* cross-origin: not ours to touch */
    }
  }

  return false
}
