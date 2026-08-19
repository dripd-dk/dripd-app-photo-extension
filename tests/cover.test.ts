/**
 * The cover: what the popup shows while the retailer page is on its way.
 *
 * It used to be a function serialised into the page by the background, injected
 * on every `tabs.onUpdated` in the hope of winning a race against the page's own
 * rendering. Firefox settled that hope — it blocks content-script execution in a
 * moz-extension document, so the injection fired too early to be allowed and
 * then, from the pre-inject shot, too late to be useful. It now ships inside the
 * bundle and runs at `document_start`, before the document has painted anything.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { installCover, removeCover, LOADING_HOST_ID } from '../src/injected/cover'

afterEach(() => {
  document.getElementById(LOADING_HOST_ID)?.remove()
  document.documentElement.innerHTML = ''
})

describe('installCover', () => {
  it('puts a cover on the document', () => {
    installCover(document)

    expect(document.getElementById(LOADING_HOST_ID)).not.toBeNull()
  })

  it('keeps the retailer out of it, in a shadow root', () => {
    // Same reasoning as the viewfinder's: a shop stylesheet with
    // `div { display: none !important }` must not be able to blank the cover.
    installCover(document)

    expect(document.getElementById(LOADING_HOST_ID)!.shadowRoot).not.toBeNull()
  })

  it('is idempotent, because every document on the origin runs it', () => {
    installCover(document)
    installCover(document)

    expect(document.querySelectorAll(`#${LOADING_HOST_ID}`)).toHaveLength(1)
  })

  it('says what it is waiting for', () => {
    installCover(document)

    expect(document.getElementById(LOADING_HOST_ID)!.shadowRoot!.textContent).toContain('rammen')
  })
})

describe('removeCover', () => {
  it('takes it down', () => {
    installCover(document)

    removeCover(document)

    expect(document.getElementById(LOADING_HOST_ID)).toBeNull()
  })

  it('does nothing when there is no cover', () => {
    expect(() => removeCover(document)).not.toThrow()
  })
})
