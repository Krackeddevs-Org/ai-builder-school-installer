# Brand assets

Sourced from the AI Builder School site (`learn.theaibuilder.school`).

| File | What it is |
|---|---|
| `mark.png` | Official wordmark — white artwork, transparent, native 1200×517. Used in the app sidebar. |
| `site-icon.png` | Official site icon (192×192, black-on-white framed lockup). Apple-touch and favicon too. |
| `site-apple-icon.png` | Apple touch icon from the site (180×180). |
| `site-favicon.ico` | Site favicon (16/32px). |
| `monogram-ai.png` | The "AI" monogram cropped from `mark.png`. |
| `icon-mono-1024.png` | **App icon source** — the AI monogram in white on brand navy `#0b1a4a`, 1024×1024. |
| `app-icon-mono.png` | Same, flattened RGB for platforms that dislike alpha. |

## Why the app icon is the monogram, not the full wordmark

The full "AI BUILDER SCHOOL" lockup is illegible below roughly 64px — at 32px the letters
collapse into noise. App icons must read at 16–32px, so the icon uses the **AI monogram**
on the brand navy background. The full wordmark is still used at large sizes (the app
sidebar, the README).

Regenerate the Tauri icon set after changing the source:

```bash
cp assets/brand/icon-mono-1024.png src-tauri/icons/icon.png
cd src-tauri && npx @tauri-apps/cli icon icons/icon.png
```
