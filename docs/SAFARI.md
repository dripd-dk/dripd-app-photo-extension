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

From the command line, without a signing identity:

```bash
cd "safari/dripd photo"
xcodebuild -scheme "dripd photo (macOS)" -configuration Debug \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO build
```

## Enable it in Safari

An unsigned extension needs Safari told to allow it:

1. Run the macOS app once. It does nothing but register the extension.
2. Safari → Settings → **Advanced** → tick *Show features for web developers*.
3. Safari → **Develop** → *Allow Unsigned Extensions*. This resets every time
   Safari restarts.
4. Safari → Settings → **Extensions** → enable **dripd photo**.

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

- **Signing.** Built ad-hoc so far, which is enough to run locally and not enough to
  distribute. Distribution needs an Apple Developer account, a team id set on both
  targets, and App Store review; Safari has no unsigned-extension sideloading for
  ordinary users.
- **iOS.** The converter emitted an iOS target too. It has never been built or run,
  and the extension's popup-window flow almost certainly does not translate to iOS
  Safari — there are no extension-opened popup windows there. Treat the iOS target
  as scaffolding, not a plan.
- **Behaviour.** The macOS app compiles. Nothing beyond that has been verified: no
  capture has ever been run in Safari.

## Known risks specific to Safari

- `optional_host_permissions` and the grant flow behave differently, and the
  permission page is the first thing likely to break.
- `windows.create({ type: 'popup' })` is supported but its focus and sizing
  behaviour differ; the code already falls back to a plain popup, then a tab.
- Safari has no `browser.identity`, which is why nothing here uses it.
