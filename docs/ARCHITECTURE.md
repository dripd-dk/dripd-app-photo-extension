# Architecture

Why this extension is shaped the way it is. The [README](../README.md) covers what
it does and how to audit it; this is for anyone changing the code.

## The one hard constraint

`image.hm.com` answers a residential browser with 200, a datacenter IP with 403,
and a page-context `fetch` with nothing at all — it sends no
`Access-Control-Allow-Origin`, so a web page can never read those bytes. The
background context of an extension is the only place in the stack that can.

Everything else here is a consequence of that.

## Three verbs the page can call, and a fourth it cannot

| Verb | Meaning |
|---|---|
| `harvest(url)` | Opens the popup, **waits for the user to frame a photo**, leaves it open |
| `fetchBytes(sessionId, url)` | Fetches in that session; **extends its TTL** |
| `resolve(sessionId, action)` | **Window only:** closes or surfaces it |
| `framed(sessionId, …)` | Sent by the injected overlay. Settles `harvest` |

`resolve` closes the *window*, not the *session*. The page ranks the harvest
server-side and resolves at that point — before the user has picked anything — so a
session that died on resolve would fail every later `fetchBytes` and no capture
could ever complete. Sessions carry their own 60 s TTL, extended by each fetch,
which doubles as the valve stopping a crashed page from leaking a popup.

`harvest` is the odd one: it parks on a human and can stay pending for minutes.
Three things end that wait — a 5 min frame timeout, the tab closing, and the cancel
button — and all three reject rather than hang, because a hang upstream is a studio
stuck on a spinner.

## Why the user frames the photo

Measured on a real H&M product page in a warm consumer Chrome, 2026-08-14:

| DOM state | gallery photos | 116px thumbs | unrelated product cards |
|---|---|---|---|
| fresh load | 3 | 2 | **0** |
| after browsing the carousel | 6 | 1 | 9 |
| after a full-page scroll | **3 — unchanged** | 2 | 9 |

The gallery is a Splide carousel whose slides load on *interaction*, so a page the
extension merely opens shows three of six photos. Scrolling adds **zero** and drags
in nine related-product cards that no size or URL heuristic tells apart from
product photos.

An earlier version answered that by driving the carousel itself — generic thumbnail
clicks, next-buttons, arrow keys — unioning each harvest. It worked, and was still
the wrong shape: where the thumbnail strip and the related-products rail are
indistinguishable to a generic selector, the garment the user wants is one tile
among thirty and the extension is guessing which.

So the person who knows says so. `collect` runs on their button press and not
before. The carousel gets advanced by the user, which is the one mechanism that was
never going to break on the next retailer.

A thumbnail in the frame is not a dead end: rewriting its `imwidth` to 2160 returns
a genuine 2160×3240 image, so framing a 116px thumb still captures the
full-resolution photograph.

**The framed photo is ranked first, not auto-captured.** Framing is aim, not
confirmation — a grab that caught the neighbouring tile has to stay one click from
recovery. That matters more than it sounds: the cutout is 80% of the window, so it
overlaps almost everything on screen and selection leans on a largest-overlap rule
rather than on precise aim.

## The viewfinder

- **A scaled-down copy of the window** — same aspect ratio, 80% of each axis. It
  started as a 3:4 portrait, which is a phone's logic; in a landscape desktop popup
  that wastes most of the window.
- **The frame edge carries its own contrast** — white ring inside, white ring
  outside, dark ring around that. A single white line over a 20% scrim was invisible
  on a white shop page, and appeared only once the user scrolled and a dark photo
  passed under the edge.
- **`pointer-events: none` everywhere except the button bar**, so scrolling,
  clicking a thumbnail and dragging a carousel all reach the shop's page underneath.
- **Shadow DOM with an `all: initial` reset**, so a site with
  `div { display: none !important }` in some print stylesheet cannot blank it.
- **No `<img>` anywhere in it.** Shadow content is invisible to
  `document.querySelectorAll('img')` regardless, so `collect` cannot mistake the
  extension's own chrome for a product photo.

## Nothing of the page before the viewfinder

Between the popup opening and the viewfinder appearing there is a second or two
of the retailer's own page: the load has to finish, `settleMs` has to pass, a
consent wall has to be dismissed, and only then can the overlay mount. Shown
bare, that reads as a window that opened and did nothing.

So the popup is covered. `showLoadingScrim` in `router.ts` is injected the moment
the window exists and again on every `tabs.onUpdated` for that tab — the first
injection can land on the popup's `about:blank` and be discarded when the
navigation commits, and a page that renders progressively is visible long before
it reports `complete`. Listening stops just before `injected.js` goes in, and one
last cover is injected there, on the document the viewfinder will mount into.

`mountFrameOverlay` takes it down, in that same document, in the same turn it
builds the overlay — a signal from the background context would leave a frame in
which the page is bare. The id is a literal in `router.ts` because the function
is serialised into the page and cannot close over an import; `frame.ts` exports
it as `LOADING_HOST_ID` and the router tests match against that, so the two
cannot drift. A 20 s self-removal inside the cover is the valve: every path that
ends a capture closes the window, and if one ever does not, showing the page
beats trapping the user behind an opaque panel.

## Security

The extension is functionally a CORS-bypass proxy holding the user's cookies. The
`content_scripts.matches` list is the only thing stopping any website from driving
it, so treat it as code, not configuration:

- `matches` is dripd's origin only. No `http:` in the production build.
- The relay requires `event.source === window` **and**
  `event.origin === location.origin`, so an iframe embedded in a dripd page cannot
  drive it.
- Every message carries a page-issued nonce and a direction: the page sends
  `dir: 'req'` and accepts only `dir: 'res'`. That discriminator is load-bearing —
  `window.postMessage` delivers a page's own message to its own listeners, so
  without it every request rejects itself milliseconds after being sent. The page
  side once shipped that way, non-functional, with thirteen green tests.
- The background never fetches a URL that did not arrive through the bridge, and
  never anything that is not `https:`.

MV3 idle-terminates a background service worker after roughly 30 seconds, which
would drop the session map and its TTL timer mid-capture and orphan the popup.
While any session is alive the worker therefore makes one throwaway API call every
20 seconds to reset that idle timer, and stops the moment the last session ends.
Persisting sessions instead would mean adding a `storage` permission for state that
is worthless after a restart.

## Layout

| File | Responsibility |
|---|---|
| `src/protocol.ts` | The wire contract with dripd.dk. Read this first |
| `src/router.ts` | Verbs, popup lifecycle, sessions, byte fetching — all testable |
| `src/sw.ts` | Background wiring. Eight lines |
| `src/bridge.ts` | The relay and its origin checks — the security boundary |
| `src/bridge.content.ts` | Content-script wiring |
| `src/injected/collect.ts` | Read images and metadata off a DOM |
| `src/injected/consent.ts` | Reject a cookie wall. Never accepts |
| `src/injected/frame.ts` | The viewfinder, and what counts as framed |
| `src/injected/index.ts` | Installs `__dripdHarvest` in the isolated world |
| `src/permissions.ts` + `onboarding.*` | The one-time host grant |

## Tests

92 tests, ~1 s, no browser. `npm test` builds first so the bundle test cannot run
against a stale `dist/`.

- `collect` / `consent` / `key` / `frame` — pure functions over a happy-dom DOM. The
  `frame` tests feed rects in through a `data-rect` attribute, because happy-dom
  does no layout: every element reports 0×0, so a selection test written against
  real geometry passes without deciding anything.
- `router` — the full session lifecycle against a faked extension API: the window
  stays open after `harvest`, `dismiss` closes it, `surface` focuses it, and
  **`fetchBytes` still works after either** (the test that stops someone "fixing"
  resolve into a session teardown). Plus TTL expiry, re-arming on fetch, the
  popup→tab fallback chain, and every rejection path.
- `router`, framing — that nothing is collected before the button is pressed, and
  that all three endings reject, close the window, and leave no session or pending
  promise behind. The fake presses the button from inside `executeScript`, which is
  where a real user would.
- `bridge` — the origin, source and direction checks against a **real** window. Note
  the fidelity gap called out in that file: happy-dom does not populate
  `MessageEvent.source`, so inbound requests are dispatched explicitly. Without
  that, three of those tests pass vacuously — exactly the trap that hid the
  direction bug the first time.
- `injected-bundle` — evaluates the built `dist/injected.js` the way the browser
  does, catching a bundle that imports something the build left out.
- the loading cover — that it goes up before anything else is injected, goes up
  again on every progress report, stops once the viewfinder is armed (or it
  would cover that), and that a cover the popup rejects still leaves a working
  capture. `tabNeverComplete` holds the popup in `loading` so the window this is
  all about can actually be driven; the default fake answers `tabs.get` with
  `complete` and skips straight past it.

What tests cannot cover is the thing most likely to break: whether an
extension-driven popup on a bot-managed product page behaves like a hand-typed
navigation. Only a warm consumer profile finds that out, by hand, per retailer.

## What each browser needed

All three run the full capture. Getting there took a specific fix per engine, and
they are worth knowing before changing anything in this area.

**Firefox** makes every host permission opt-in, including the ones implied by
`content_scripts.matches`. Chrome injects a declared content script without
asking; Firefox does not run it until its site is granted. The production grant
(`https://*/*`) cannot cover an http dev server, so the dev build declares the
localhost origins as optional host permissions — otherwise there is nothing in the
permissions UI to switch on and the bridge silently never exists. Firefox also
registers content scripts at extension-load time: granting a host afterwards needs
an extension reload before it takes effect.

**Safari** differs in two ways that both looked like our bugs:

- `windows.create` resolves **without the documented `tabs` array**. Reading that
  absence as failure abandoned a good window and opened another, then fell through
  to a tab — two popups, and the injection landing somewhere that was never the
  retailer's page. `tabs.query({windowId})` is the authority; `create` is not.
- Host access is granted in Safari's own Settings, per site. `permissions.request()`
  produces no prompt, so the grant page must show instructions rather than a button
  and watch for the grant instead of asking for it. That also creates a dead end —
  permission gates the content script, the content script is how the studio sees
  the extension, and the studio is what opens the grant page — which is why the
  toolbar button opens it.

**Chrome** needed none of this, which is exactly why testing on it alone proves
very little.

## Still unverified

- **Edge, Brave, Opera, Arc, Vivaldi.** Same engine, same build as Chrome.
- **iOS Safari.** The converter emits an iOS target; the popup-window flow almost
  certainly does not translate, since iOS Safari has no extension-opened windows.
