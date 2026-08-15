# Privacy policy — dripd

_Last updated 2026-08-15._

The extension's full source is at
<https://github.com/dripd-dk/dripd-app-photo-extension>, under the MIT licence.
Everything below can be checked against it, and the README explains how.

The dripd extension exists to do one thing: when you paste a product link into the
dripd studio, fetch that product's image from the shop in your own browser, so you
can use it in an outfit.

## What it does

- It acts **only** when you ask it to, from a page on dripd.dk. It does nothing on
  any other website, and nothing in the background.
- When you ask, it opens the shop's page in a window with a frame over it, and
  waits. **Nothing is read while you are browsing that page.**
- When you press the button, it reads the **addresses of the images on that page**
  and the product's public name, brand and price — at that moment, once.
- When you pick an image, it downloads that one image and hands it to the dripd
  page you are working in.

## What it stores

**Nothing.** The extension has no storage. It keeps a short-lived note in memory
of the capture you are currently doing, for at most 60 seconds after your last
action, and forgets it. Closing your browser leaves nothing behind.

## What it sends, and where

The image you choose is sent to dripd's own servers to have its background
removed, and returned to you. It is **not saved** there unless you go on to
publish the outfit — that is your action, in the dripd app, not the extension's.

The extension sends nothing to anyone else. No analytics, no telemetry, no
third-party services, no advertising identifiers.

## Browsing data

The extension does not read your browsing history, your bookmarks, your saved
passwords, or your open tabs. It does not track which sites you visit. It does not
inject anything into shop pages beyond the code that reads that one page's images
when you ask it to.

## Why it asks for access to websites

Shops serve their images from servers that refuse ordinary web-page requests. Only
an extension, running in your own browser with your own session, can download
them. That is what the permission is for, and it is requested when you first use
the feature rather than at install time, so you can see what it is for.

To be precise about what "your own session" means: when the extension downloads the
photo you chose, that request carries whatever cookies your browser already holds
for that shop — the same ones any normal request from your browser would send. That
is what makes it work where a server-side download fails. The extension does not
read those cookies, does not store them, and does not send them anywhere except to
the shop they already belong to.

You can withdraw it at any time in your browser's extension settings. The rest of
dripd keeps working; you upload images by hand instead.

## Contact

kontakt@dripd.dk
