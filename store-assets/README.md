# Store assets

Screenshots for the Chrome, Edge, Firefox and Mac App Store listings.

**1280×800**, which is the one size all four accept — shoot once, use everywhere.
24-bit PNG, no alpha (Chrome rejects alpha in screenshots).

| File | Shows |
|---|---|
| `dripd-screenshot-1.png` | The studio, and the viewfinder framing a garment on a real H&M page. **Use this first** — it is the whole product in one frame. |
| `dripd-screenshot-2.png` | The frame over a full product page, showing it works on a real retailer rather than a mock. |

Made from Retina captures (3024 wide) with:

```bash
ffmpeg -i shot.jpeg -vf "crop=W:H:X:Y,scale=1280:800:flags=lanczos" -pix_fmt rgb24 out.png
```

Two things worth repeating on any new screenshot:

- **Crop the Dock out.** It is visual noise, and it publishes the list of
  applications on the machine.
- **Shoot a real shop page.** An obviously staged mock reads as a red flag on an
  extension that asks for broad host access.
