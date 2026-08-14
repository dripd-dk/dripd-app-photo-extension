import { describe, expect, it } from 'vitest'
import { normalizeKey } from '../src/injected/key'

/** Mirrors `dripd-app/server/utils/linkHarvest.ts`. Only used here to tell "a new
 *  photo" from "the same photo at another size" while advancing a carousel. */
describe('normalizeKey', () => {
  it('collapses rendition parameters', () => {
    const a = normalizeKey('https://image.hm.com/assets/hm/e2/74/e274.jpg?imwidth=116')
    const b = normalizeKey('https://image.hm.com/assets/hm/e2/74/e274.jpg?imwidth=2160')
    expect(a).toBe(b)
  })

  it('keeps genuinely different assets apart', () => {
    expect(normalizeKey('https://cdn.test/a.jpg?imwidth=1260')).not.toBe(
      normalizeKey('https://cdn.test/b.jpg?imwidth=1260'),
    )
  })

  it('collapses size segments in the path', () => {
    expect(normalizeKey('https://cdn.test/w_800/p.jpg')).toBe(
      normalizeKey('https://cdn.test/w_1600/p.jpg'),
    )
    expect(normalizeKey('https://cdn.test/1200x1200/p.jpg')).toBe(
      normalizeKey('https://cdn.test/600x600/p.jpg'),
    )
  })

  it('keeps meaningful query parameters, order-independently', () => {
    expect(normalizeKey('https://cdn.test/p.jpg?v=2&imwidth=800&sig=abc')).toBe(
      normalizeKey('https://cdn.test/p.jpg?sig=abc&v=2&imwidth=100'),
    )
    expect(normalizeKey('https://cdn.test/p.jpg?v=2')).not.toBe(
      normalizeKey('https://cdn.test/p.jpg?v=3'),
    )
  })

  it('returns unparseable input untouched rather than throwing', () => {
    expect(normalizeKey('not a url')).toBe('not a url')
  })
})
