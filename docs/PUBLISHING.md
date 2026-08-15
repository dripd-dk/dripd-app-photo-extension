# Publishing

Four stores, four accounts, four review queues. Chrome, Edge and Firefox take the
same source; Safari ships as a Mac app.

Nothing here is published yet. Everything below is the work between "it runs
locally" and "a stranger can install it".

---

## Do these once, before any store

These block every submission, so they are worth clearing first.

### 1. A hosted privacy policy

Every store requires a **URL**, not a file. [`PRIVACY.md`](../PRIVACY.md) is the
content; it needs a page.

**Done.** <https://dripd.dk/udvidelsen/privatliv> — Danish and English, switchable
on the page itself, because store reviewers are overwhelmingly not Danish speakers.

It lives in `dripd-app/app/pages/udvidelsen/privatliv.vue` rather than in the
database-backed legal pages, so it cannot drift from what the extension does: a
permission change and a policy change land in the same review. [`PRIVACY.md`](../PRIVACY.md)
is the same text — **keep the two in step.**

### 2. Screenshots

Every store wants them, and this extension is unusually easy to photograph well
because the viewfinder *is* the product. Three shots tell the whole story:

1. The studio with a product link pasted in
2. The popup with the viewfinder over a shop's page, garment framed
3. The picker with the framed photo first

| Store | Size | Count |
|---|---|---|
| Chrome | 1280×800 or 640×400 | 1–5 |
| Edge | 1280×800 | 1–10 |
| Firefox | any, 1280×800 is safe | optional but do it |
| Safari (macOS) | 1280×800 / 1440×900 / 2560×1600 / 2880×1800 | up to 10 |

1280×800 satisfies all four. Take them on a real shop page — an obviously staged
mock reads as a red flag to reviewers.

### 3. Decide what the listing says

Same copy everywhere, in Danish and English. Keep the description honest about the
one thing it does; the permissions ask for a lot and a vague listing is what turns
a routine review into a rejection.

- **Name:** dripd
- **Summary:** Henter produktbilleder fra en butiks side, når du selv beder om det
  på dripd. Intet gemmes.
- **Category:** Shopping
- **Single purpose:** "Fetch a product image from a shop page the user has linked
  to, so it can be used in an outfit on dripd.dk."

### 4. Version

`manifest.json` and `package.json` are at **1.0.0**. Every store rejects a re-upload
at the same version, so bump both together for each resubmission.

---

## Chrome Web Store

**Account:** one-time **$5** registration fee.
**Console:** <https://chrome.google.com/webstore/devconsole>

```bash
npm run build
cd dist && zip -r ../dripd-chrome-1.0.0.zip . && cd ..
```

Upload `dripd-chrome-1.0.0.zip`.

The part that takes the time is **Privacy practices**. Each permission needs a
justification in plain language, and they are checked against what the code does:

| Field | What to write |
|---|---|
| `scripting` | Puts the image-picker frame on the shop page the user opened, and reads that page's image addresses when the user presses the button. |
| `tabs` | Opens the shop page in a window and closes it afterwards. Not used to read tab contents, history or URLs. |
| Host permission `https://*/*` | Downloads the chosen image from whichever shop the user linked to. Shops' image servers refuse requests from other websites, so this can only happen in the user's own browser. Requested at first use, not at install. |
| Remote code | **No.** Everything executed ships in the package. |
| Data usage | Not collected, not sold, not transferred. Certify all three. |

Also set:

- **Single purpose** — the sentence above
- **Privacy policy URL** — from step 1
- **Homepage** — the GitHub repo (already in the manifest)

**Expect a slow review.** Broad host permissions plus a Shopping category is the
combination that gets a closer look. The listing pointing at public source is the
strongest thing you have; say so in the justification.

---

## Microsoft Edge Add-ons

**Account:** free. Partner Center.
**Console:** <https://partner.microsoft.com/dashboard/microsoftedge>

Upload the **same** `dripd-chrome-1.0.0.zip`. Edge is Chromium and the manifest
needs no changes.

Same permission justifications. Reviews are usually faster than Chrome's.

---

## Firefox Add-ons (AMO)

**Account:** free, a Firefox account.
**Console:** <https://addons.mozilla.org/developers/>

```bash
npm run build:firefox
cd dist-firefox && zip -r ../dripd-firefox-1.0.0.zip . && cd ..
```

Three things are specific to AMO:

**`data_collection_permissions` is required.** Firefox 140 added it and AMO rejects
any upload without it — the manifest declares `required: ["websiteContent"]`, since
the extension reads image addresses and product metadata off a shop page and hands
them to dripd. `"none"` would be the narrower reading (the extension itself
transmits nothing to us; the page does the upload), but under-declaring is a policy
violation and over-declaring never is.

Validate before uploading, with Mozilla's own linter — it is the same one AMO runs:

```bash
npx addons-linter dist-firefox      # want: 0 errors, 0 warnings, 0 notices
```


**The add-on id is already fixed** — `capture@dripd.dk`, in
`browser_specific_settings`. Do not change it after the first submission; it is the
identity users' installs are tied to.

**Source code submission is required.** AMO requires it whenever the uploaded files
were produced by a build step, which ours are (esbuild). Provide the repo and
build instructions:

> Source: https://github.com/dripd-dk/dripd-app-photo-extension
> Build: `npm ci && npm run build:firefox` — output in `dist-firefox/`
> Node 20+. The build is not minified; the uploaded files are byte-comparable to
> the build output.

Not minifying was deliberate and it pays off here: a reviewer can diff the upload
against a local build directly.

---

## Safari (Mac App Store)

**Account:** Apple Developer Program, **$99/year** — already held, team
`U7MKB3Q475`.
**Console:** <https://appstoreconnect.apple.com>

Safari extensions ship inside a Mac app, so this is an app submission.

1. **Create the app record** in App Store Connect with bundle id
   `dk.dripd.photoextension`.
2. **Archive** — in Xcode, open `safari/dripd photo/dripd photo.xcodeproj`, select
   the **dripd photo (macOS)** scheme and *Any Mac*, then **Product → Archive**.
   Requires a **Distribution** certificate; the Development one used for local
   testing is not enough.
3. **Distribute App → App Store Connect** from the Organizer.
4. Fill in the listing, screenshots and privacy answers, then submit.

Before archiving, rebuild the extension so the app carries current code — the Xcode
project references `../../../dist`:

```bash
npm run build
```

**Two things will come up in review.** The app window itself does nothing except
say "enable me in Safari", which is normal for extension wrappers but reviewers ask
about it — the description should state plainly that the app exists to deliver a
Safari extension. And Apple's privacy questionnaire is per-data-type: the honest
answer is that no data is collected.

Note the wrapper is regenerated by `--force`, which would wipe manual Xcode
changes. Keep any signing or capability change recorded in
[`SAFARI.md`](SAFARI.md), not only in the project file.

---

## After the first release

Replace the placeholder store URLs. They live in one table:
`dripd-app/app/utils/extensionTarget.ts` — currently each store's root rather than
a listing, so the install prompt sends people somewhere real but unspecific. Each
becomes its listing URL once you have it.

Then the grant page's GitHub link, the README badges, and this file's "nothing is
published yet" opening are all true statements that need updating.
