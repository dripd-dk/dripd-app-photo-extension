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

---

## AMO privacy policy field

Firefox is the odd one out: its "This add-on has a Privacy Policy" box is a
**textarea Mozilla hosts**, not a URL. Chrome, Edge and Apple all take the URL
(<https://dripd.dk/udvidelsen/privatliv>) instead.

AMO renders no Markdown, so this is plain text. If the listing offers per-locale
fields, use each version separately; if there is only one field, paste both with
Danish first.

### Dansk

```text
dripd-udvidelsen gør én ting: når du selv indsætter et link til en vare, henter den varens billede fra butikken i din egen browser, så du kan bruge det i et fit.

HVAD DEN GØR
Den handler kun, når du beder om det, fra en side på dripd.dk. Den gør ingenting på andre websteder og ingenting i baggrunden.
Når du beder om det, åbner den butikkens side i et vindue med en ramme henover, og venter. Der bliver ikke læst noget, mens du kigger på siden.
Når du trykker på knappen, læser den adresserne på billederne på den side samt varens offentlige navn, mærke og pris — på det tidspunkt, én gang.
Når du vælger et billede, henter den netop det ene billede og giver det til den dripd-side, du arbejder i.

HVAD DEN GEMMER
Ingenting. Udvidelsen har ingen lagerplads. Den holder en kortvarig note i hukommelsen om den igangværende hentning, i højst 60 sekunder efter din sidste handling, og glemmer den derefter. Lukker du browseren, er der intet tilbage.

HVAD DEN SENDER, OG HVORHEN
Billedet, du vælger, sendes til dripds egne servere for at få baggrunden fjernet og sendes retur til dig. Det gemmes ikke der, medmindre du går videre og udgiver dit fit — det er din handling, i dripd-appen, ikke udvidelsens.
Udvidelsen sender intet til nogen anden. Ingen analyse, ingen telemetri, ingen tredjepartstjenester, ingen annonce-id'er.

BROWSERDATA
Udvidelsen læser ikke din browserhistorik, dine bogmærker, dine gemte adgangskoder eller dine åbne faner. Den registrerer ikke, hvilke websteder du besøger. Den indsætter intet på butikkers sider ud over den kode, der læser netop den sides billeder, når du beder om det.

OM COOKIES
Udvidelsen sætter ingen cookies og gemmer ingen. Men vær opmærksom på dette: når udvidelsen henter det billede, du har valgt, sendes de cookies med, som din browser allerede har til den butik — præcis som ved enhver anden forespørgsel fra din browser. Det er dét, der får det til at virke, hvor en hentning fra en server bliver afvist. Udvidelsen læser dem ikke, gemmer dem ikke og sender dem ikke andre steder hen end til den butik, de i forvejen hører til.

HVORFOR DEN BEDER OM ADGANG TIL WEBSTEDER
Butikker leverer deres billeder fra servere, der afviser almindelige forespørgsler fra websider. Kun en udvidelse, der kører i din egen browser med din egen session, kan hente dem. Tilladelsen bliver bedt om, første gang du bruger funktionen — ikke ved installation. Du kan altid trække den tilbage i din browsers indstillinger for udvidelser.

OPEN SOURCE
Hele udvidelsen er offentlig under MIT-licens, og koden er ikke minificeret, så alt ovenstående kan kontrolleres: https://github.com/dripd-dk/dripd-app-photo-extension

KONTAKT
kontakt@dripd.dk
Denne tekst findes også på https://dripd.dk/udvidelsen/privatliv
```

### English

```text
The dripd extension does one thing: when you paste a link to an item yourself, it fetches that item's image from the shop in your own browser, so you can use it in an outfit.

WHAT IT DOES
It acts only when you ask it to, from a page on dripd.dk. It does nothing on any other website, and nothing in the background.
When you ask, it opens the shop's page in a window with a frame over it, and waits. Nothing is read while you are browsing that page.
When you press the button, it reads the addresses of the images on that page and the item's public name, brand and price — at that moment, once.
When you pick an image, it downloads that one image and hands it to the dripd page you are working in.

WHAT IT STORES
Nothing. The extension has no storage. It keeps a short-lived note in memory of the capture you are currently doing, for at most 60 seconds after your last action, and forgets it. Closing your browser leaves nothing behind.

WHAT IT SENDS, AND WHERE
The image you choose is sent to dripd's own servers to have its background removed, and returned to you. It is not saved there unless you go on to publish the outfit — that is your action, in the dripd app, not the extension's.
The extension sends nothing to anyone else. No analytics, no telemetry, no third-party services, no advertising identifiers.

BROWSING DATA
The extension does not read your browsing history, your bookmarks, your saved passwords, or your open tabs. It does not track which sites you visit. It does not inject anything into shop pages beyond the code that reads that one page's images when you ask it to.

ABOUT COOKIES
The extension sets no cookies and stores none. One thing worth being precise about: when it downloads the image you chose, that request carries whatever cookies your browser already holds for that shop — the same ones any normal request from your browser would send. That is what makes it work where a server-side download is refused. The extension does not read them, does not store them, and does not send them anywhere except to the shop they already belong to.

WHY IT ASKS FOR ACCESS TO WEBSITES
Shops serve their images from servers that refuse ordinary web-page requests. Only an extension, running in your own browser with your own session, can download them. The permission is requested when you first use the feature, not at install time. You can withdraw it at any time in your browser's extension settings.

OPEN SOURCE
The whole extension is public under the MIT licence, and the code is not minified, so everything above can be checked against it: https://github.com/dripd-dk/dripd-app-photo-extension

CONTACT
kontakt@dripd.dk
This text is also at https://dripd.dk/udvidelsen/privatliv
```

**The cookie paragraph is the one that matters.** AMO reviewers read the manifest,
see `https://*/*`, and check whether the policy accounts for it. A policy claiming
"no cookies" flat, next to a `credentials: 'include'` fetch in public source, is
how a submission turns into a conversation.
