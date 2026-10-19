# AI Builder School — Real Brand Tokens

Extracted live from `https://learn.theaibuilder.school/_next/static/immutable/chunks/1w8ttqtf8qx9e.css`
(58 KB stylesheet, fetched 2026-10-19). These are the actual production CSS custom
properties, not estimates from a screenshot.

## Fonts (real @font-face families)

| Token | Stack |
|---|---|
| `--font-geist-sans` | `"Geist", "Geist Fallback"` |
| `--font-geist-mono` | `"Geist Mono", "Geist Mono Fallback"` |
| `--font-slabo` | `"slabo", "slabo Fallback"` (serif — display face) |
| `--font-body` | `var(--font-geist-sans), system-ui, sans-serif` |
| `--font-display` | `var(--font-slabo), Georgia, serif` |
| `--font-mono` | `var(--font-geist-mono), ui-monospace, monospace` |

**So the school uses Geist (sans) + Geist Mono + Slabo (serif display).** Not Inter.
Load Geist from Google Fonts / CDN (`Geist` and `Geist Mono` are on Google Fonts now),
Slabo from Google Fonts (`Slabo 27px`).

## Colour palette (light theme → dark theme)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#eef2fb` | `#0b1a4a` | page background |
| `--bg-outer` | `#0b1a4a` | — | outside-the-shell background |
| `--paper` | `#ffffff` | `#f5f7ff` | card / panel surface |
| `--paper-ink` | `#0b1a4a` | — | text on paper |
| `--paper-line` | `#c0cdef` | — | border on paper |
| `--paper-muted` | `#526796` | — | muted text on paper |
| `--surface` | `#ffffff` | `#11265f` | raised surface |
| `--surface-raised` | `#e6ecfa` | `#203a79` | higher surface |
| `--accent` | `#0b1a4a` | `#dce8ff` | **primary action** |
| `--accent-hover` | `#172d68` | `#ffffff` | accent hover |
| `--accent-ink` | `#0b1a4a` | `#f5f7ff` | text on accent |
| `--fg` | `#0b1a4a` | `#f5f7ff` | foreground |
| `--fg-muted` | `#3f4f7a` | `#c0cdef` | muted foreground |
| `--fg-faint` | `#7b88ad` | `#8a9bc9` | faintest text |
| `--border` | `#c0cdef` | `#526796` | default border |
| `--border-strong` | `#8fa3d1` | `#7f93c4` | strong border |
| `--ok` | `#1f7a45` | `#6fe3a4` | success |
| `--warn` | `#8a5a00` | `#ffc85c` | warning |
| `--danger` | `#b3261e` | `#ff7a7a` | error |
| `--rail` | `15rem` (light) / `4.5rem` | | sidebar width, collapsed state |
| `--rail-fg` | `#f5f7ff` | | rail text |
| `--rail-fg-muted` | `#c0cdef` | | rail muted text |
| `--rail-accent` | `#dce8ff` | | rail active item |
| `--rail-line` | `#dce8ff29` | | rail border (16% alpha) |

**Core brand colour is navy `#0b1a4a`** with a pale blue-white `#dce8ff` accent and
lavender-tinted neutrals. The UI is essentially monochrome navy + light neutrals,
with only success/warn/danger adding hue.

## THE SIGNATURE DETAIL: cut corners, not rounded corners

This is the thing that makes AIBS look like AIBS. The CSS defines:

```css
--cut: 14px;
--cut-sm: 8px;
--angle: polygon(0 0, calc(100% - var(--cut)) 0, 100% var(--cut), 100% 100%, 0 100%);
--angle-sm: polygon(0 0, calc(100% - var(--cut-sm)) 0, 100% var(--cut-sm), 100% 100%, 0 100%);
```

So panels/buttons use `clip-path` with the **top-right corner sliced off at 45°**, plus
`--radius-pill: 999rem` for genuinely pill-shaped elements (badges/status chips).

Also present:
- `--angle-sm` variant (8px cut) for small elements.
- `--touch: 2.75rem` (44px) — the minimum touch target, worth honouring.
- `--maxw: 73.75rem` (1180px) — content max width.
- Motion: `--default-transition-duration: .15s`, `--ease-out: cubic-bezier(.2,.8,.2,1)`,
  `--motion-quick: .18s`, `--motion-page: .24s`.

**Design rule to copy:** flat navy, 1px borders, generous whitespace, Geist type,
**clipped top-right corners** on cards and buttons, pill shapes only for badges.
No gradients, no heavy shadows.

## Implementation gotcha learned while building the wizard

A `border-radius` on a `clip-path` element produces **no visible rounding** — the clip
wins and the corner is exactly as clipped. To get the chamfer you must use `clip-path`;
if you also want a visible border on the clipped edge, the border gets clipped too, so
either accept the cut border or draw it with a separate element.

Verify it actually applied rather than trusting a screenshot:
`getComputedStyle(el).clipPath` should return the `polygon(...)` string. A 14px cut is
easy to mistake for a small radius at normal zoom — zoom in before concluding.

## Design system decision

Material 3 Expressive was evaluated and **rejected** in favour of the school's own brand.
AIBS is flat navy with clipped corners and a snappy `.18s` ease-out; M3 Expressive is
bouncy springs with large radii. They clash. Matching the school's identity matters more
than borrowing a general design system.