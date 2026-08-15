# Notes for reviewers

Paste-ready text for the "notes to reviewer" field each store provides.

**Every store needs this, and it is the most common reason a review stalls:** the
extension does nothing visible without an account on dripd.dk. A reviewer who
installs it, sees no interface, and finds a request for access to all https sites
has every reason to reject it. Give them a working account and the exact steps.

> ## ⚠️ Fill in the credentials yourself
>
> The `<...>` placeholders below are for a **dedicated test account** — not a real
> user's, and not an admin's. Create one on dripd.dk and paste the details in when
> you submit. Do not commit them to this file: this repository is public.
>
> Give the account no more privilege than a normal creator needs, and expect the
> reviewer to leave content behind in it.

---

## Chrome, Edge and Firefox

```text
WHAT THIS EXTENSION DOES

dripd.dk is a service for building outfit collages from clothes in online shops.
When a user pastes a link to an item, this extension opens that shop's page in a
window, lets the user frame the photo they want, and downloads that one image.

It exists because shops serve their product images from servers that refuse
requests coming from other websites. dripd.dk cannot download them from its own
page or its own servers; only an extension running in the user's browser can.

A TEST ACCOUNT IS REQUIRED

The extension has no interface of its own and does nothing until it is driven from
a logged-in page on dripd.dk.

    Sign in at: https://dripd.dk/log-ind
    Email:      <TEST ACCOUNT EMAIL>
    Password:   <TEST ACCOUNT PASSWORD>

HOW TO TEST IT

1. Install the extension.
2. Sign in at https://dripd.dk/log-ind with the account above.
3. Go to https://dripd.dk/studie and open or create a fit ("Nyt fit").
4. In the left column, under "LINK TIL VAREN", paste a link to any product page
   from a clothing shop. A known-good example:
   <WORKING PRODUCT URL>
5. Press "Hent billeder" (Get images).
6. The first time only, a dripd page opens asking for permission. Press "Giv
   tilladelse" and accept the browser's prompt. Then press "Hent billeder" again.
   - On Firefox, the permission must also be granted for the site; the page
     explains this.
7. A window opens on the shop's page with a frame drawn over it. Scroll that page
   until the product photo you want is inside the frame.
8. Press "Hent billeder" in that window.
9. The window closes and the studio shows the images it found, the framed one
   first. Click one; it is added to the fit with its background removed.

WHAT TO LOOK FOR

- Nothing is read from the shop's page until step 8. The extension waits.
- The extension does nothing on any site other than dripd.dk. Its content script
  is restricted to dripd.dk in the manifest.
- No data is stored. The extension declares no "storage" permission.

SOURCE

Public and unminified, MIT licensed:
https://github.com/dripd-dk/dripd-app-photo-extension

`npm ci && npm run build` reproduces the uploaded package byte for byte, so it can
be diffed directly against this submission.

Privacy policy: https://dripd.dk/udvidelsen/privatliv
Contact: kontakt@dripd.dk
```

---

## Safari (App Store Connect → App Review Information → Notes)

Apple reviews a Mac app, so it needs the extra step of enabling the extension, and
an explanation of why the app window is nearly empty.

```text
THIS APP DELIVERS A SAFARI EXTENSION

The app itself has no functionality beyond delivering and enabling the extension —
this is the standard structure for a Safari web extension. Its window only explains
how to turn the extension on.

ENABLING IT

1. Launch the app once.
2. Safari > Settings > Extensions, and enable "dripd photo".
3. In that same panel, set access for dripd.dk to "Always Allow".
   Safari grants host access here rather than through a prompt, so this step
   cannot be done from inside the extension.

A TEST ACCOUNT IS REQUIRED

    Sign in at: https://dripd.dk/log-ind
    Email:      <TEST ACCOUNT EMAIL>
    Password:   <TEST ACCOUNT PASSWORD>

Then follow the same steps as above: open a fit at https://dripd.dk/studie, paste a
product link, press "Hent billeder", frame the photo, press the button.

WHY IT ASKS FOR WEBSITE ACCESS

Shops serve product images from servers that refuse requests from other websites.
The download can only happen in the user's own browser. The permission is requested
in context, at first use, not at install.

No data is collected or stored. Source: https://github.com/dripd-dk/dripd-app-photo-extension
```

---

## If a reviewer reports it "does nothing"

That is almost always one of three things, in order of likelihood:

1. **Not signed in to dripd.dk.** The studio is behind a login.
2. **Host permission not granted.** It is optional and requested at first use — on
   Firefox and Safari it may need granting in browser settings rather than through
   a prompt.
3. **They pasted a dripd.dk link** instead of a shop link. The studio now refuses
   this explicitly, but an older build would open a window on dripd itself.

Answer with the specific step rather than asking them to retry.
