# dripd photo extension

When you're building an outfit on [dripd.dk](https://dripd.dk) and you paste a link
to something in a shop, this extension fetches that product's photo so you can drop
it straight into your fit.

That's all it does. It has no interface of its own beyond one page asking your
permission, it doesn't run in the background, and it stores nothing.

**You shouldn't have to take our word for any of that.** The whole thing is here,
it's about 1,500 lines, and the section below shows you how to check it yourself —
including how to have an AI read it for you if you'd rather not read code.

---

## How it works

1. You paste a product link in the dripd studio and press **Hent billeder**.
2. The extension opens the shop's page in a window, with a frame over it.
3. You scroll until the photo you want is inside the frame, and press the button.
4. That photo goes into your fit. The window closes.

Nothing is collected before you press that button. The extension doesn't decide
which photo you meant — you do, by framing it.

### Why an extension is needed at all

Most big shops serve their images from servers that refuse requests coming from
another website's code, and often refuse requests from data centres entirely. A
normal web page — including dripd.dk — simply cannot download those images. A
browser extension running in *your* browser can, because to the shop it looks like
you browsing, which is what it is.

That's the entire reason this exists. If shops allowed it, dripd would do this on
its own servers and you'd have nothing to install.

---

## Audit it yourself

You don't need to trust a privacy policy. Here's how to check.

### The fast version, with an AI

Clone the repo and point an AI coding assistant at it:

```bash
git clone https://github.com/dripd-dk/dripd-app-photo-extension
cd dripd-app-photo-extension
```

Then ask it something like:

> Read this browser extension's source. Ignore the README and comments — they can
> lie. Answer from the code only:
>
> 1. What data leaves my machine, to which domains, and on what trigger?
> 2. Can any website other than dripd.dk cause this extension to do anything?
> 3. Does it read, store, or transmit browsing history, cookies, form input,
>    passwords, or the contents of pages I visit normally?
> 4. Does anything run when I am not actively using it?
> 5. Is there any obfuscated, minified, dynamically evaluated, or remotely loaded
>    code?
> 6. What is the worst thing a malicious version of this extension could do with
>    the permissions it requests in `manifest.json`?

Question 6 is the important one, and the honest answer isn't "nothing" — see
[What it could do, if we were lying](#what-it-could-do-if-we-were-lying).

**Where the answers live.** It's a small codebase; these are the files that matter:

| File | Why it matters |
|---|---|
| `manifest.json` | Every permission it can ever have |
| `src/bridge.ts` | The gate. Decides which pages may talk to the extension |
| `src/router.ts` | Everything the extension can be asked to do |
| `src/injected/collect.ts` | What it reads off a shop's page |
| `src/injected/frame.ts` | The frame you aim with |
| `src/permissions.ts` | What access it asks for, and when |

### The thorough version

An AI reading the source tells you the source is clean. It doesn't tell you the
extension **you installed** was built from that source. To check that, build it
yourself and compare:

```bash
npm install
npm run build          # → dist/
```

Then unpack the version you installed from the store and diff the two. The build is
deliberately **not minified** for exactly this reason — the shipped JavaScript is
meant to stay readable, so a reviewer can compare it line by line.

Run the tests too, since they document the security rules as executable checks:

```bash
npm test
```

Look at `tests/bridge.test.ts` in particular. It's the one asserting that pages
which aren't dripd.dk get ignored.

### Watch it work, live

`chrome://extensions` → dripd → **service worker** opens its console. Every capture
logs exactly what it did. If it ever logs something when you *aren't* capturing,
that's a bug worth reporting — [open an issue](https://github.com/dripd-dk/dripd-app-photo-extension/issues).

---

## The permissions, in plain language

| Permission | What it's for | What it isn't |
|---|---|---|
| `scripting` | Put the frame on the shop's page, and read that page's image addresses when you press the button | It can't run anywhere you haven't sent it |
| `tabs` | Open the shop window and close it afterwards | It does **not** grant reading your tabs' contents, history, or URLs |
| `https://*/*` *(optional)* | Download the photo from whichever shop you linked to | Asked for when you first capture, not at install. Revocable any time |

That last one is the big one, and it's deliberately **optional** — that's why
installing this prompts you for nothing, and why the request arrives later, in
context, on a page explaining it.

There is **no** `storage` permission. The extension physically cannot remember
anything between restarts.

### What it could do, if we were lying

Being straight with you: `https://*/*` is broad. An extension with it could read
pages you visit and send them anywhere. That's true of this one's *permissions* —
what stops it is the code, which is why the code is public.

The specific things to verify, if you're checking rather than trusting:

- `content_scripts.matches` in `manifest.json` lists **only** dripd.dk. That's the
  only page allowed to talk to the extension at all.
- `src/bridge.ts` additionally checks the message came from the page itself and not
  from an embedded frame.
- Nothing here fetches a URL that didn't arrive through that gate, and nothing
  non-`https:` ever gets fetched.
- There's no analytics endpoint, no telemetry, and no remote configuration. The
  only network request the extension ever makes is downloading the photo you chose.

If you find that any of the above isn't true, that's a security bug and we want to
hear about it.

---

## Install

Not in the browser stores yet — see [`docs/PUBLISHING.md`](docs/PUBLISHING.md) for
what that takes. To run it now, build it and load it unpacked:

```bash
npm install
npm run build
```

**Chrome / Edge / Brave / Arc:** `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → select `dist/`.

**Firefox:** `npm run build:firefox`, then `about:debugging#/runtime/this-firefox` →
**Load Temporary Add-on** → select `dist-firefox/manifest.json`. Note that a
temporary add-on is removed when Firefox restarts, and takes any permission you
granted it with it.

**Safari:** it can't load a folder — the extension has to be wrapped in a native
app. See [`docs/SAFARI.md`](docs/SAFARI.md).

## Browser support

| Browser | State |
|---|---|
| Chrome | **Verified** — full capture, end to end |
| Firefox | **Verified** — full capture, end to end |
| Safari | **Verified** — full capture, end to end. Setup: [`docs/SAFARI.md`](docs/SAFARI.md) |
| Edge, Brave, Opera, Arc, Vivaldi | Same engine and same build as Chrome; not separately tested |

Each of the three took its own fix, and none of them were cosmetic — a Firefox
build that could not be granted access to a dev server, a Safari `windows.create`
that answers without the tab it just made. Details in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Firefox needs its own build because it can't use Chrome's background service worker
([bug 1573659](https://bugzilla.mozilla.org/show_bug.cgi?id=1573659)). One manifest
carries both forms and each build drops the one its browser doesn't want.

## Development

```bash
npm run build:dev           # also matches localhost:3000, for working on dripd itself
npm run build:firefox:dev   # the same, for Firefox
npm test                    # 83 tests, no browser required
npm run typecheck
```

The plain `build:firefox` matches dripd.dk only, so it cannot talk to a local dev
server — use `build:firefox:dev` for that.

Architecture and design decisions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Privacy

[`PRIVACY.md`](PRIVACY.md) — short, and written to be read.

## Licence

MIT. See [`LICENSE`](LICENSE).
