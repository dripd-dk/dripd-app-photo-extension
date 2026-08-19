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
| `ready` | **Bundle only:** which capture, if any, owns my tab |
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
of the retailer's own page. Shown bare, that reads as a window that opened and
did nothing.

**The popup opens on `loading.html`, not on the retailer**, and *then something
waits for it*. `windows.create` resolves when the window exists, not when its tab
has loaded, so the first version of this navigated on within milliseconds and
reproduced the original bug exactly. That wait is matched by URL prefix — an
extension URL's origin is the string `"null"`, so an origin comparison there
decides nothing.

**The visible tab is then never navigated at all.** The retailer loads in a
second, hidden tab of the same window, and the swap happens when its bundle
reports in. A navigation is the one moment nothing can be painted: Firefox holds
the previous page's pixels only for **same-origin** navigations, and
`moz-extension:` to `https:` is neither same-origin nor same-process, so for the
length of the retailer's time-to-first-byte the window showed the browser's own
background — the user's theme colour, flashing between two spinners. No content
script can cover a document that does not exist yet, so the answer is not to have
a gap rather than to fill one.

The swap is triggered by `ready`, which the bundle sends *after* installing its
cover. By the time we answer it, the hidden tab's document already carries the
same spinner the visible one is showing, so the handover is invisible precisely
because both sides are drawn the same.

That tab is created **empty** and navigated afterwards, rather than created on
the URL, so `session.tabId` is known before anything can load in it. `ready` is
answered by matching that id, and a bundle asking before we knew it would be told
to stand down and would never arm.

**The bundle is registered, not injected.** `scripting.registerContentScripts`,
`run_at: document_start`, the retailer's origin, one registration per capture.
The browser runs it before each document paints, and `installCover` is the first
thing it does.

That replaced three failed attempts at injecting the cover from the background,
and the reasons are worth keeping because they all look like our bugs:

- Firefox **blocks** content-script execution in a moz-extension document, so
  every injection arriving while the tab was still on our loading page failed
  outright.
- `tabs.update` does not change a tab's URL synchronously, so those events kept
  arriving with the old URL current no matter where the listener was armed.
- The only injection that reliably landed was the one after the load wait and the
  settle — by which point the shop had been fully visible for the better part of
  a second, which is the exact thing a cover exists to prevent.

None of that is a race that can be won by moving a listener. It was moved three
times.

**A navigation is no longer a failure.** Every document on the origin runs the
bundle, including the ones a redirect or a reload produces, so the viewfinder
re-arms itself instead of being lost. That is what the old inject-once, arm-once
pair could not do at any timing.

The registration matches an **origin**, so it also runs in whatever other tabs
the user has open on that shop. The bundle cannot tell from the page which tab it
is in, so it asks: `ready` is answered from the sender's tab, and a tab with no
session is told to stand down and takes its own cover off. It is the one message
whose meaning depends on its sender rather than its contents, because its whole
question is "which tab am I".

`persistAcrossSessions` is **false** deliberately. The default is true, and a
registration left behind would keep running on that shop, in every tab and every
window, until the browser restarts. It is undone in `closeWindow` rather than
when `harvest` returns, because the window outliving the harvest is the point: on
an empty ranking the studio surfaces it again and the user re-frames, and until
the window is gone a navigation still needs to re-arm.

`mountFrameOverlay` takes the cover down, in the same document and the same turn
it builds the overlay. `cover.ts` owns the id and `frame.ts` imports it — it used
to be a literal duplicated in `router.ts`, because a function serialised into the
page cannot close over an import.

## The extension does not touch a cookie wall

It used to. `arm` clicked the reject button, waited 400 ms, and mounted the
viewfinder. A real cookie wall reloads the page when either button is pressed,
and that reload raced the 400 ms timer — when it won, it took the just-mounted
overlay with it, and nothing re-arms a document that has been replaced. The user
got a shop page with no viewfinder and no button, and the session hung until the
five-minute frame timeout. Intermittently, because it was a race.

Read from the outside it looked like the extension loading the page twice: first
paint, consent click, reload. It was our own click.

The wall is the user's to dismiss now. They are already standing in front of the
page to frame a photo, and the overlay is `pointer-events: none` everywhere but
its own button bar — so the wall is one click away for them and zero navigations
away for us. `meta.version` is 3; `consentDismissed` is gone with the code.

The deeper problem this exposed is still open: **nothing re-arms after a
navigation.** `__dripdHarvest` lives in the isolated world of one document, and a
redirect or a soft navigation on the retailer's own initiative loses the
viewfinder exactly the same way. Removing our own click removes the cause we
were creating, not the class.

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
| `src/injected/frame.ts` | The viewfinder, and what counts as framed |
| `src/injected/index.ts` | Covers the document, asks whose tab it is, arms itself |
| `src/injected/cover.ts` | The cover, from `document_start` until the viewfinder |
| `src/loading.html` | The popup's first paint, before the retailer loads |
| `src/permissions.ts` + `onboarding.*` | The one-time host grant |

## Tests

108 tests, ~1 s, no browser. `npm test` builds first so the bundle test cannot run
against a stale `dist/`.

- `collect` / `key` / `frame` — pure functions over a happy-dom DOM. The
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
- the loading cover — that the window opens on our own page, that nothing
  navigates off it or covers it until it is actually on screen (`popupStartsLoading`
  holds the tab in `loading` the way a real one starts, which the fake used to
  hide by reporting `complete` from the first instant), that our page finishing is not mistaken for the retailer
  finishing, that the retailer's document is covered on every progress report,
  that covering stops once the viewfinder is armed (or it would cover that), and
  that a cover the popup rejects still leaves a working capture. The fake's tabs
  carry a URL for this: `tabNeverComplete` holds the popup mid-load and
  `stallNavigation` holds it on our page, because the default answers `tabs.get`
  with `complete` and skips straight past the window this is all about.
- `build-output` — that `dist/loading.html` exists and carries no script. The
  router names that page as a string through `runtime.getURL`; nothing else in
  the repo connects the string to a file, so a build that stopped copying it
  would pass everything else and open every capture on a blank error page.

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
