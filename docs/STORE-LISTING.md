# Store listing copy

Paste-ready, Danish and English. Same text everywhere — a listing that differs per
store is a listing that drifts.

Field limits differ, so the short forms are written to the **tightest** one and
reused: Chrome's summary caps at 132 characters, App Store's subtitle at 30.

---

## Danish

### Kort beskrivelse / summary

> Hent produktbilledet fra butikkens side, når du selv beder om det. Du vælger billedet. Intet gemmes.

### Undertitel (App Store, maks. 30)

> Butiksbilleder til dine fits

### Kampagnetekst (App Store, maks. 170)

> Indsæt et link til en vare, sæt billedet i rammen, og det lander i dit fit med baggrunden fjernet. Du vælger billedet — udvidelsen gætter ikke.

### Beskrivelse

> dripd-udvidelsen henter produktbilledet fra en butiks side, så du kan bruge det, når du bygger et fit på dripd.
>
> **Sådan virker det**
>
> 1. Indsæt et link til varen i dripd-studiet.
> 2. Udvidelsen åbner butikkens side i et vindue med en ramme henover.
> 3. Rul, til det billede du vil bruge er inde i rammen, og tryk "Hent billeder".
> 4. Billedet lander i dit fit, med baggrunden fjernet.
>
> **Du vælger billedet — udvidelsen gætter ikke.** Der bliver ikke hentet noget, før du trykker på knappen. På en varesides billedkarrusel ligner miniaturer og "andre kunder kiggede også på" hinanden til forveksling, og det er dig, der ved, hvilket billede du vil have.
>
> **Hvorfor skal det være en udvidelse?**
>
> De fleste butikker leverer deres billeder fra servere, der afviser forespørgsler fra andre websteder. En almindelig hjemmeside — dripd.dk indbefattet — kan derfor ikke hente dem. Det kan en udvidelse, der kører i din egen browser, fordi det for butikken bare ser ud, som om du selv kigger. Hvis butikkerne tillod det, ville dripd gøre det på sine egne servere, og du skulle ikke installere noget.
>
> **Hvad den aldrig gør**
>
> - Gemmer ingenting. Udvidelsen har slet ingen lagerplads.
> - Læser ikke din historik, dine bogmærker, dine adgangskoder eller dine åbne faner.
> - Ingen sporing, ingen annoncer, ingen tredjepartstjenester.
> - Kører ikke i baggrunden og gør ingenting på andre websteder end dripd.dk.
>
> **Open source**
>
> Hele udvidelsen er offentlig, under MIT-licens. Koden er ikke minificeret, så den kan læses — og bygges, så du selv kan sammenligne med det, du har installeret:
> github.com/dripd-dk/dripd-app-photo-extension
>
> Kræver en konto på dripd.dk.
> Privatliv: dripd.dk/udvidelsen/privatliv

---

## English

### Short description / summary

> Grab the product photo from a shop's page when you ask it to. You pick the photo. Nothing is stored.

### Subtitle (App Store, max 30)

> Shop photos into your fits

### Promotional text (App Store, max 170)

> Paste a link to an item, frame the photo you want, and it lands in your outfit with the background removed. You pick the photo — the extension doesn't guess.

### Description

> The dripd extension grabs a product photo from a shop's page so you can use it while building an outfit on dripd.
>
> **How it works**
>
> 1. Paste a link to the item in the dripd studio.
> 2. The extension opens the shop's page in a window with a frame over it.
> 3. Scroll until the photo you want is inside the frame, then press "Hent billeder".
> 4. The photo lands in your outfit, background already removed.
>
> **You pick the photo — the extension doesn't guess.** Nothing is collected until you press the button. On a product page, the thumbnail strip and the "customers also viewed" rail look identical to any automatic picker, and you're the one who knows which photo you actually want.
>
> **Why does this need an extension?**
>
> Most shops serve their images from servers that refuse requests coming from other websites. An ordinary web page — dripd.dk included — simply cannot download them. An extension running in your own browser can, because to the shop it looks like you browsing, which it is. If shops allowed it, dripd would do this on its own servers and you'd have nothing to install.
>
> **What it never does**
>
> - Stores nothing. The extension has no storage at all.
> - Doesn't read your history, bookmarks, passwords or open tabs.
> - No tracking, no ads, no third-party services.
> - Doesn't run in the background, and does nothing on any website other than dripd.dk.
>
> **Open source**
>
> The whole extension is public, MIT licensed. The code isn't minified, so it can be read — and built, so you can compare it against what you installed:
> github.com/dripd-dk/dripd-app-photo-extension
>
> Requires a dripd.dk account.
> Privacy: dripd.dk/udvidelsen/privatliv

---

## Notes

**Keep "Hent billeder" untranslated in the English copy.** The button in the
extension is Danish, because the whole product is; describing it in English as
"Get images" would send an English-speaking user looking for a button that does not
exist.

**The "why an extension" paragraph is not marketing.** It is the answer to the
question every reviewer asks about broad host permissions, written where a user can
read it too. Do not trim it.

**Say the account requirement plainly.** An extension that appears to do nothing
without an account elsewhere is a common rejection reason, and a common one-star
review.
