# Safari

Safari cannot load a web extension from a folder. It only loads one that is
embedded inside a signed native app, so `safari/` holds an Xcode project wrapping
this extension in a macOS app and an iOS app.

The wrapper contains no logic. `SafariWebExtensionHandler.swift` is boilerplate from
Apple's template; the extension is the same `dist/` every other browser gets.

## Build it

```bash
npm run build          # required first — see below
open "safari/dripd photo/dripd photo.xcodeproj"
```

Then pick the **dripd photo (macOS)** scheme and run.

**`npm run build` is not optional.** The Xcode project *references* `../../../dist/`
rather than keeping its own copy, so there is exactly one build of the extension and
the Safari app cannot silently ship a stale one. `dist/` is git-ignored, so a fresh
clone has to build before Xcode will succeed.

From the command line, signed with the dripd team:

```bash
cd "safari/dripd photo"
xcodebuild -scheme "dripd photo (macOS)" -configuration Debug \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=U7MKB3Q475 CODE_SIGN_STYLE=Automatic build
```

`U7MKB3Q475` is dripd's paid Apple Developer Program team — the same one
`dripd-mobile` signs with. `-allowProvisioningUpdates` lets xcodebuild mint the
certificate and profile without opening Xcode, given a signed-in account
(`dripddk@proton.me`).

Verify the team rather than the certificate's name:

```bash
codesign -dv "/Applications/dripd photo.app" 2>&1 | grep TeamIdentifier
# want: TeamIdentifier=U7MKB3Q475
```

The name printed on the chosen identity is whichever team member's certificate
Xcode picked — it has read "Apple Development: Benjamin Albrectsen" while signing
correctly for the dripd team. **The name on a certificate is not the team.**

`spctl -a` will still say `rejected`: this is a Development certificate, not
Developer ID + notarization. That is expected locally, and precisely what Safari's
*Allow Unsigned Extensions* switch is for.

### The ad-hoc fallback

Without an account, ad-hoc works for local testing:

```bash
xcodebuild -scheme "dripd photo (macOS)" -configuration Debug \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES build
```

**`CODE_SIGNING_ALLOWED=YES` is load-bearing.** Setting it to `NO` still builds
and still reports success, but Xcode then skips signing entirely and you get the
linker's automatic signature — `flags=0x20002(adhoc,linker-signed)` with
`Identifier=dripd photo Extension` instead of the bundle id. macOS refuses to
register an app extension signed that way, **silently**: the app launches, Safari
shows no extension, and nothing anywhere says why. Check with:

```bash
codesign -dv "/Applications/dripd photo.app/Contents/PlugIns/dripd photo Extension.appex"
# want: flags=0x2(adhoc), Identifier=dk.dripd.photoextension.Extension
pluginkit -m | grep dripd
# want: dk.dripd.photoextension.Extension(1.0)
```

## Getting Safari to see it

macOS discovers Safari extensions from the registry, so the app has to be
somewhere LaunchServices trusts. A build in `DerivedData` does **not** register.
Copy it to `/Applications` and run it once:

```bash
cp -R ~/Library/Developer/Xcode/DerivedData/dripd_photo-*/Build/Products/Debug/"dripd photo.app" /Applications/
open "/Applications/dripd photo.app"
pluginkit -m | grep dripd      # confirm before hunting through Safari's settings
```

## Enable it in Safari

An unsigned extension needs Safari told to allow it:

1. Run the macOS app once. It does nothing but register the extension.
2. Safari → Settings → **Advanced** → tick *Show features for web developers*.
3. Safari → **Develop** → *Allow Unsigned Extensions*. This resets every time
   Safari restarts.
4. Safari → Settings → **Extensions** → enable **dripd photo**.

## Building for the App Store

```bash
npm run build                      # the Xcode project references ../../../dist
cd "safari/dripd photo"

xcodebuild -scheme "dripd photo (macOS)" -configuration Release \
  -archivePath /tmp/dripd-photo.xcarchive \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=U7MKB3Q475 CODE_SIGN_STYLE=Automatic \
  archive

xcodebuild -exportArchive -archivePath /tmp/dripd-photo.xcarchive \
  -exportPath /tmp/dripd-export -exportOptionsPlist export-appstore.plist \
  -allowProvisioningUpdates
```

`-allowProvisioningUpdates` mints what is missing without opening Xcode: it created
the Mac App Store provisioning profile for `dk.dripd.photoextension` and the
installer certificate for team `U7MKB3Q475`, neither of which existed on this Mac.
The only Distribution certificate present belonged to a different team (Loofers
ApS), so do not assume an existing one will do — **check the team, not the name on
the certificate.**

Output is `/tmp/dripd-export/dripd photo.pkg`, which is what App Store Connect
takes. Upload it from Xcode's Organizer, which uses the signed-in account.

**`LSApplicationCategoryType` is required** and lives in `macOS (App)/Info.plist`.
Without it, archiving warns and the App Store rejects. It is set to
`public.app-category.lifestyle`: the Mac App Store has no Shopping category, unlike
the Chrome Web Store where this is listed under Shopping.

## Regenerating the wrapper

If `manifest.json` gains a permission or a file, the wrapper needs regenerating:

```bash
npm run build
rm -rf safari && mkdir safari
xcrun safari-web-extension-converter dist \
  --project-location safari \
  --app-name "dripd photo" \
  --bundle-identifier dk.dripd.photoextension \
  --swift --no-open --no-prompt --force
```

`--force` overwrites, so any manual edit inside `safari/` — a signing team, a
capability, a bumped version — is lost. Keep such changes documented here rather
than only in the project file.

## What is not done

- **Upload and review.** The App Store package builds and signs; nobody has
  uploaded it yet. That needs an app record in App Store Connect and a reviewer
  test account (the extension does nothing without a dripd.dk login) — see
  [`REVIEWER-NOTES.md`](REVIEWER-NOTES.md).
- **iOS.** The converter emitted an iOS target too. It has never been built or run,
  and the extension's popup-window flow almost certainly does not translate to iOS
  Safari — there are no extension-opened popup windows there. Treat the iOS target
  as scaffolding, not a plan.

## Behaviour: verified

A full capture works in Safari 26 on macOS 26 — framing, grabbing, and the byte
fetch. Three Safari-specific things had to change to get there, all documented in
[`ARCHITECTURE.md`](ARCHITECTURE.md):

- `windows.create` resolves **without a `tabs` array**, which made the router open
  two popups and inject into neither.
- Host access is granted in **Safari → Settings → Extensions**, per site.
  `permissions.request()` shows no prompt, so the grant page shows steps instead
  and polls for the result.
- The toolbar button opens the grant page, because permission gates the content
  script and the content script is what lets the studio ask for permission.

Safari has no `browser.identity`, which is why nothing here uses it.
