/**
 * Asset identity, mirrored from `dripd-app/server/utils/linkHarvest.ts`.
 *
 * Only used here to union harvests across carousel advances: the same photo
 * reached twice at two rendition sizes must count once, or the bound of eight
 * advances gets spent re-finding images we already have.
 *
 * This is a deliberate, documented duplication of server logic. The server still
 * dedupes authoritatively — it has to, because the mobile client sends raw lists
 * too. If the two ever disagree the cost is a duplicate tile in the picker, not
 * a failure, which is why a shared package would be more coupling than the
 * problem deserves.
 */

// Query parameters that describe a rendition, not the asset.
const SIZE_PARAMS = new Set([
  'imwidth', 'width', 'w', 'h', 'height', 'size',
  'quality', 'q', 'fit', 'dpr', 'format', 'fm',
])

const SIZE_PATH = new RegExp(
  '/(?:w|h|s|c)_?\\d{2,4}(?:[,x]\\d{2,4})?/' + // /w_800/, /h_1200/
  '|/\\d{2,4}x\\d{2,4}/' +                     // /1200x1200/
  '|_\\d{2,4}x\\d{2,4}(?=\\.\\w+$)',           // prod_800x1000.jpg
  'gi',
)

export function normalizeKey(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  const path = parsed.pathname.replace(SIZE_PATH, '/')
  const kept: [string, string][] = []
  parsed.searchParams.forEach((v, k) => {
    if (!SIZE_PARAMS.has(k.toLowerCase())) kept.push([k, v])
  })
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
  const query = kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  return `//${parsed.host}${path}${query ? `?${query}` : ''}`
}
