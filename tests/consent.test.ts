import { beforeEach, describe, expect, it } from 'vitest'
import { dismissConsent } from '../src/injected/consent'

function clicksOn(el: Element): string[] {
  const log: string[] = []
  el.addEventListener('click', () => log.push((el as HTMLElement).id || 'unnamed'))
  return log
}

describe('dismissConsent', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('clicks a known reject handler', () => {
    document.body.innerHTML = '<button id="onetrust-reject-all-handler">Afvis alle</button>'
    const log = clicksOn(document.querySelector('button')!)

    expect(dismissConsent(document)).toBe(true)
    expect(log).toEqual(['onetrust-reject-all-handler'])
  })

  it('falls through to the text pass, which is what H&M actually needs', () => {
    // None of the six CSS selectors match H&M — this path is the primary one.
    document.body.innerHTML = `
      <div id="cmp">
        <button id="settings">Administrer</button>
        <button id="reject">Afvis alle</button>
        <button id="accept">Accepter alle</button>
      </div>
    `
    const rejected = clicksOn(document.getElementById('reject')!)
    const accepted = clicksOn(document.getElementById('accept')!)

    expect(dismissConsent(document)).toBe(true)
    expect(rejected).toEqual(['reject'])
    expect(accepted).toEqual([])
  })

  it('never clicks accept, even when it is the only button', () => {
    document.body.innerHTML = '<button id="accept">Accepter alle cookies</button>'
    const accepted = clicksOn(document.getElementById('accept')!)

    expect(dismissConsent(document)).toBe(false)
    expect(accepted).toEqual([])
  })

  it('ignores banner prose that merely contains the word', () => {
    document.body.innerHTML = `
      <div role="button" id="prose">
        Du kan afvise ikke-nødvendige cookies ved at ændre dine indstillinger nedenfor,
        eller læse mere om hvordan vi behandler dine data.
      </div>
    `
    const clicked = clicksOn(document.getElementById('prose')!)

    expect(dismissConsent(document)).toBe(false)
    expect(clicked).toEqual([])
  })

  it('reaches into a same-origin iframe', () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const inner = frame.contentDocument!
    inner.body.innerHTML = '<button id="didomi-notice-disagree-button">Decline</button>'
    const log = clicksOn(inner.querySelector('button')!)

    expect(dismissConsent(document)).toBe(true)
    expect(log).toEqual(['didomi-notice-disagree-button'])
  })

  it('reports false when there is no banner at all', () => {
    document.body.innerHTML = '<main><h1>Skjorte</h1></main>'
    expect(dismissConsent(document)).toBe(false)
  })
})
