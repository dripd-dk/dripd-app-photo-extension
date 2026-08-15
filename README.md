# dripd-capture

The browser extension that lets the dripd studio read product images from a
retailer's page. It does the three things a web page cannot:

1. Open a retailer page in a real browser.
2. Let the user point at the photo they want, on that page, and read its URL off
   the DOM at that moment.
3. Fetch the chosen image's bytes with the user's own session and IP.

Step 2 is the only UX that lives here rather than in dripd-app, and it has to:
the page being framed is the retailer's, and nothing on dripd.dk can draw on it
or read what is under the frame.

That second one is the whole reason this exists. `image.hm.com` answers a
residential browser with 200, a datacenter IP with 403, and a page-context
`fetch` with nothing at all — it sends no `Access-Control-Allow-Origin`, so the
background context of an extension is the only place in the stack that can read
those bytes.

**Nothing is stored.** No `storage` permission, no history, no background
activity. Bytes pass through to the page and the page holds them in memory until
the user publishes an outfit.

## Try it (dev)

```bash
npm install && npm run build:dev
```

Then, in Chrome:

0. **Remove the dev stub first** (`dripd capture (dev stub)`, from
   `dripd-app/scripts/dev-capture-stub/`). It matches `localhost:3000` too, so with
   both loaded two extensions answer every request and you will be debugging the
   wrong one.
1. `chrome://extensions` → **Developer mode** on → **Load unpacked** →
   pick the **`dist-dev/`** folder (not `dist/` — the dev build is the one that
   matches `localhost:3000`).
2. Open the studio at `http://localhost:3000`, paste a product link, press
   **Hent billeder**.
3. The first capture opens a dripd tab asking for host access. Press **Giv
   adgang** and accept your browser's prompt, then press **Hent billeder** again.

Expect: a popup window opens on the retailer's page with a viewfinder over it.
**Nothing is collected yet.** Scroll the page until the photo you want sits inside
the frame, press **Hent billeder** in that window, and the studio's picker fills
with the framed photo first.

There is **no permission prompt at install time** — `https://*/*` is declared
`optional_host_permissions`, so the ask arrives later, in context, from the
onboarding page. (An earlier version of these instructions claimed the install
prompted; it does not.)

### Watching it work

`chrome://extensions` → dripd → **service worker** opens the background console.
A capture logs two lines — one when the viewfinder goes up, one when the user
presses the button:

```
[dripd] framing 3f1c… https://www2.hm.com/da_dk/productpage.1358428002.html
[dripd] harvest 3f1c… 41 images { version: 2, consentDismissed: true, framed: true, framedMatches: 2 }
```

- `framed` — was there an image inside the cutout at all? `false` means the user
  pressed the button with an empty frame; they still get a ranked picker.
- `framedMatches` — how many harvest rows the framed element accounted for. One
  `<img>` contributes its `currentSrc`, `src` and widest `srcset` rendition, so
  1–3 is normal.

`framed: true` with `framedMatches: 0` is contradictory and worth reporting: the
viewfinder found an `<img>` that `collect` did not record, which silently drops
the user's choice back to plain server ranking.

A `framing` line with no `harvest` line after it is a session the user closed,
cancelled, or walked away from — all three are normal.

## Why the user frames it

Measured on a real H&M PDP in a warm consumer Chrome, 2026-08-14:

| DOM state | gallery photos | 116px thumbs | unrelated product cards |
|---|---|---|---|
| fresh load | 3 | 2 | **0** |
| after browsing the carousel | 6 | 1 | 9 |
| after a full-page scroll | **3 — unchanged** | 2 | 9 |

The gallery is a Splide carousel whose slides load on *interaction*, so a page
this extension merely opens shows three of six photos. Scrolling adds **zero**
and drags in nine related-product cards that no size or URL heuristic tells apart
from product photos.

An earlier version answered that by driving the carousel itself — generic
thumbnail clicks, next-buttons, arrow keys — and unioning each harvest. It worked
on H&M and was still the wrong shape: on a page where the thumbnail strip and the
related-products rail are indistinguishable to a generic selector, the garment the
user actually wants is one tile among thirty, and the extension is guessing which.

So the person who knows says so. The popup opens with a viewfinder over the page,
they scroll the photo into it, and `collect` runs on their button press and not
before. The carousel gets advanced by the user, which is the one mechanism that
was never going to break on the next retailer.

A thumbnail in the frame is not a dead end: rewriting its `imwidth` to 2160
returns a genuine 2160×3240 image, so framing a 116px thumb still captures the
full-resolution photograph.

**The framed photo is ranked first, not auto-captured.** Framing is aim, not
confirmation — a grab that caught the neighbouring tile has to stay one click from
recovery, so the picker still opens with every candidate behind the framed one.

**It never clicks anything on the page.** The overlay is `pointer-events: none`
except its own button bar, so scrolling and dragging reach the retailer's page
underneath, and the extension itself never follows a link.

## Layout

| File | Responsibility |
|---|---|
| `src/protocol.ts` | The wire contract with dripd-app. Read this first |
| `src/router.ts` | Verbs, popup lifecycle, sessions, byte fetching — all testable |
| `src/sw.ts` | Background wiring. Eight lines |
| `src/bridge.ts` | The relay and its origin checks — the security boundary |
| `src/bridge.content.ts` | Content-script wiring |
| `src/injected/collect.ts` | Read images and metadata off a DOM |
| `src/injected/consent.ts` | Reject a cookie wall. Never accepts |
| `src/injected/frame.ts` | The viewfinder, and what counts as framed |
| `src/injected/index.ts` | Installs `__dripdHarvest` in the isolated world |
| `src/permissions.ts` + `onboarding.*` | The one-time host grant |

Three verbs the page can call, and a fourth it cannot:

| Verb | Meaning |
|---|---|
| `harvest(url)` | Opens the popup, **waits for the user to frame a photo**, leaves it open |
| `fetchBytes(sessionId, url)` | Fetches in that session; **extends its TTL** |
| `resolve(sessionId, action)` | **Window only:** closes or surfaces it |
| `framed(sessionId, …)` | Sent by the overlay, not the page. Settles `harvest` |

`harvest` is the one that changed shape. It used to answer in seconds; it now
parks on a human and can stay pending for minutes. Three things end that wait —
the frame timeout (5 min), the tab being closed, and the Annullér button — and all
three reject rather than hang, because a hang upstream is a studio stuck on a
spinner. The page side allows six minutes for this verb alone, deliberately above
the extension's own ceiling so the specific reason arrives before a generic
timeout does.

`resolve` closes the *window*, not the *session*. The page ranks the harvest
server-side and resolves at that point — before the user has picked anything — so
a session that died on resolve would fail every later `fetchBytes` and no capture
could ever complete. Sessions instead carry their own 60 s TTL, extended by each
fetch, which doubles as the valve that stops a crashed page leaking a popup.

## Security

The extension is functionally a CORS-bypass proxy holding the user's cookies. The
`content_scripts.matches` list is the only thing stopping any website from
driving it, so treat it as code, not configuration:

- `matches` is dripd's origin only. No `http:` in the production build.
- The relay requires `event.source === window` **and**
  `event.origin === location.origin`, so an iframe embedded in a dripd page
  cannot drive it.
- Every message carries a page-issued nonce, and a direction: the page sends
  `dir: 'req'` and accepts only `dir: 'res'`. That discriminator is load-bearing
  — `window.postMessage` delivers a page's own message to its own listeners, so
  without it every request rejects itself milliseconds after being sent. The page
  side once shipped that way, non-functional, with thirteen green tests.
- The background never fetches a URL that did not arrive through the bridge, and
  never anything that is not `https:`.

One consequence worth knowing: MV3 idle-terminates a background service worker
after roughly 30 seconds, which would drop the session map and its TTL timer
mid-pick and orphan the popup. While any session is alive the worker therefore makes
one throwaway API call every 20 seconds to reset that idle timer, and stops the
moment the last session ends. The alternative — persisting sessions — would mean
adding a `storage` permission for state that is worthless after a restart.

## Tests

```bash
npm test
```

80 tests, ~1 s, no browser. `npm test` builds first so the bundle test cannot
run against a stale `dist/`.

- `collect` / `consent` / `key` / `frame` — pure functions over a happy-dom DOM.
  The `frame` tests feed rects in through a `data-rect` attribute, because
  happy-dom does no layout: every element reports 0×0, so a selection test
  written against real geometry passes without deciding anything.
- `router` — the full session lifecycle against a faked extension API: the window
  stays open after `harvest`, `dismiss` closes it, `surface` focuses it, and
  **`fetchBytes` still works after either** (the test that stops someone
  "fixing" resolve into a session teardown). Plus TTL expiry dismissing an open
  window, re-arming on fetch, the popup→tab fallback chain, and every rejection
  path.
- `router`, framing — that nothing is collected before the button is pressed, and
  that all three endings (closed tab, Annullér, timeout) reject, close the window
  and leave no session or pending promise behind. The fake presses the button
  from inside `executeScript`, which is where a real user would.
- `bridge` — the origin, source and direction checks against a **real** window.
  Note the fidelity gap called out in that file: happy-dom does not populate
  `MessageEvent.source`, so inbound requests are dispatched explicitly. Without
  that, three of those tests pass vacuously — which is exactly the trap that hid
  the direction bug the first time.
- `injected-bundle` — evaluates the built `dist/injected.js` the way the browser
  does, catching a bundle that imports something the build left out.

What tests cannot cover is the only thing that can still kill this design: whether
an extension-driven popup on an Akamai-fronted product page yields a full harvest.
A popup is not a hand-typed navigation, and only a warm consumer profile can find
out. **That means Johan, by hand, on H&M, Zara, ASOS, Zalando and Nike.**

## Not built yet

- **Safari** needs a native wrapper, Xcode and App Store review. The code avoids
  `browser.identity` (Safari has none) precisely so this stays possible.
- **Firefox listing.** `npm run build:firefox` produces a loadable add-on;
  submission is out of scope, and its `optional_host_permissions` grant flow is
  unverified.
- **`focused: false`** popup behaviour is unverified outside Chromium. The code
  falls back to a focused popup, then to a background tab.
