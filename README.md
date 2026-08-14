# dripd-capture

The browser extension that lets the dripd studio read product images from a
retailer's page. It is a **pipe, not a feature**: every bit of UX lives in
dripd-app, and this side does the two things a web page cannot.

1. Open a retailer page in a real browser and read the image URLs off its DOM.
2. Fetch the chosen image's bytes with the user's own session and IP.

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

1. `chrome://extensions` → **Developer mode** on → **Load unpacked** →
   pick the **`dist-dev/`** folder (not `dist/` — the dev build is the one that
   matches `localhost:3000`).
2. Open the studio at `http://localhost:3000`, paste a product link, press
   **Hent billeder**.
3. The first capture opens a dripd tab asking for host access. Press **Giv
   adgang** and accept your browser's prompt, then press **Hent billeder** again.

Expect: a small popup window opens on the retailer's page, works for a couple of
seconds, and closes itself. The picker fills with candidates.

There is **no permission prompt at install time** — `https://*/*` is declared
`optional_host_permissions`, so the ask arrives later, in context, from the
onboarding page. (An earlier version of these instructions claimed the install
prompted; it does not.)

### Watching it work

`chrome://extensions` → dripd → **service worker** opens the background console.
Every capture logs one line:

```
[dripd] harvest 3f1c… 41 images { consentDismissed: true, advances: 5, strategies: [ 'thumbnail' ], gained: 3 }
```

- `advances` — how many times it nudged the gallery.
- `strategies` — which generic handle actually drove it: `thumbnail`,
  `next-button`, or `arrow-key`. Empty means none worked and you got the
  fresh-load harvest.
- `gained` — distinct photos found *because* of advancing.

`gained: 0` with a non-empty `strategies` is contradictory and worth reporting.
`strategies: []` on a carousel you can click by hand is the interesting bug.

## Why it advances the gallery

Measured on a real H&M PDP in a warm consumer Chrome, 2026-08-14:

| DOM state | gallery photos | 116px thumbs | unrelated product cards |
|---|---|---|---|
| fresh load | 3 | 2 | **0** |
| after browsing the carousel | 6 | 1 | 9 |
| after a full-page scroll | **3 — unchanged** | 2 | 9 |

The gallery is a Splide carousel whose slides load on *interaction*. Scrolling —
which is what the mobile flow does — adds **zero** gallery photos here and drags
in nine related-product cards that no size or URL heuristic can tell apart from
product photos. So this never scrolls; it advances instead, and unions each
harvest into the running set.

A thumbnail is not a dead end either: rewriting its `imwidth` to 2160 returns a
genuine 2160×3240 image. That is why a fresh harvest already reaches 5 of 6
photos before any advancing happens.

**Bounded on purpose:** eight advances or four seconds, then it returns whatever
it has. A carousel that ignores every handle degrades to the fresh-load result.
It must never hang — a hang is a 45 s bridge timeout and a dead studio.

**It never clicks a link.** A thumbnail strip and a related-products rail look
identical to a generic selector, and following one would silently capture a
different garment. Anything under an `<a href>` is excluded, including images
inside one, because a click on an image bubbles to the anchor.

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
| `src/injected/gallery.ts` | Advance the carousel generically, union the results |
| `src/injected/index.ts` | Installs `__dripdHarvest` in the isolated world |
| `src/permissions.ts` + `onboarding.*` | The one-time host grant |

Three verbs, and the middle one is where the design earns its keep:

| Verb | Meaning |
|---|---|
| `harvest(url)` | Opens the popup, collects, and **leaves it open** |
| `fetchBytes(sessionId, url)` | Fetches in that session; **extends its TTL** |
| `resolve(sessionId, action)` | **Window only:** closes or surfaces it |

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

## Tests

```bash
npm test
```

67 tests, ~2.5 s, no browser. `npm test` builds first so the bundle test cannot
run against a stale `dist/`.

- `collect` / `consent` / `key` / `gallery` — pure functions over a happy-dom DOM.
- `router` — the full session lifecycle against a faked extension API: the window
  stays open after `harvest`, `dismiss` closes it, `surface` focuses it, and
  **`fetchBytes` still works after either** (the test that stops someone
  "fixing" resolve into a session teardown). Plus TTL expiry dismissing an open
  window, re-arming on fetch, the popup→tab fallback chain, and every rejection
  path.
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
