# Theming — light / dark site-wide

CloudCDN ships a single shared theme system that every page (homepage, 28
locale pages, dashboard, login, upload, API reference, dist, 404) opts
into with three lines in `<head>`.

The system is driven by a `[data-theme="light" | "dark"]` attribute on
`<html>`. The attribute is set **synchronously before first paint** by
`/shared/theme-boot.js`, so there is no flash of the wrong theme. Once
loaded, `/shared/theme-toggle.js` wires the visible toggle button,
persists the user's choice in `localStorage`, and respects
`prefers-color-scheme` for first-time visitors.

## How the cascade works

```
[data-theme] on <html>                 ← set pre-paint
   ↓
:root             { color-scheme: light dark; --bg: light-dark(...); ... }
[data-theme=light]{ color-scheme: light; --bg: #f7f8fb; --surface: #ffffff; ... }
[data-theme=dark] { color-scheme: dark;  --bg: #08090d; --surface: #0f1117; ... }
   ↓
.your-component { background: var(--bg); color: var(--text); }
```

Three reasons we use explicit `[data-theme]` overrides instead of just
`light-dark()`:

1. **Third-party widgets that re-set `color-scheme`** (the Scalar API
   explorer on `/api-reference` did exactly this) flip `light-dark()`
   against us inside their root. The explicit attribute selectors are
   evaluated against `<html>`, which we control.
2. The CSS-native `light-dark()` requires `color-scheme` inheritance to
   work; explicit values are robust against any downstream override.
3. JS toggling is one attribute write — cheap, observable in DevTools.

The `:root` declaration still uses `light-dark()` so the page renders
correctly with **no JS at all** (the boot script is small but external,
and a strict CSP environment could conceivably block it).

## Adding the theme to a new page

```html
<head>
  <!-- 1. Pre-paint boot — synchronous, blocks parser briefly,
       reads localStorage + matchMedia, sets data-theme before
       any stylesheet is applied. ~600 bytes minified. -->
  <script src="/shared/theme-boot.js"></script>

  <!-- 2. The token set + [data-theme] overrides. -->
  <link rel="stylesheet" href="/shared/theme.css">

  <!-- 3. Deferred — wires the toggle button + persists choice. -->
  <script defer src="/shared/theme-toggle.js"></script>
</head>
```

Drop a `.theme-toggle` button anywhere on the page:

```html
<button type="button" class="theme-toggle" aria-label="Switch to light mode"
        aria-pressed="false" title="Toggle theme">
  <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><!-- moon path --></svg>
  <svg class="icon-sun"  viewBox="0 0 24 24" aria-hidden="true"><!-- sun path --></svg>
</button>
```

The CSS in `theme.css` toggles which icon is visible based on the
current `data-theme`. `theme-toggle.js` keeps `aria-pressed` /
`aria-label` in sync and updates the `<meta name="theme-color">` tag
for mobile browser chrome.

## The full token set

Tokens live in `cdn/shared/theme.css`. The two themes are
intentionally palette-symmetric — every token has a light value and a
dark value with comparable luminance distance from the page bg.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg`            | `#f7f8fb` | `#08090d` | Page canvas |
| `--surface`       | `#ffffff` | `#0f1117` | Card / nav fill |
| `--surface-2`     | `#f0f2f7` | `#1a1d27` | Sunken / secondary surface |
| `--border`        | `rgba(99,102,241,0.18)` | `rgba(99,102,241,0.15)` | Default border |
| `--border-subtle` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.06)` | Quiet separator |
| `--text`          | `#1a1d27` | `#e2e4ea` | Body text |
| `--text-muted`    | `#5b5f73` | `#8b8fa3` | Secondary text (AA-passing) |
| `--text-dim`      | `#62657a` | `#9da1b5` | Tertiary text (AA-passing on every shipped bg) |
| `--heading`       | `#0a0c12` | `#ffffff` | Headlines + emphasised numbers |
| `--accent`        | `#6366f1` | `#6366f1` | Brand fill |
| `--accent-hover`  | `#4f46e5` | `#818cf8` | Hover state on accent |
| `--accent-text`   | `#4338ca` | `#a5b4fc` | Accent **as text** (AA-passing — see below) |
| `--accent-soft`   | `rgba(99,102,241,0.08)` | `rgba(99,102,241,0.10)` | Accent-tinted bg |
| `--green`         | `#166534` | `#4ade80` | Success state |
| `--code-bg`       | `rgba(0,0,0,0.05)` | `rgba(0,0,0,0.30)` | Inline `code` |
| `--code-block-bg` | `rgba(0,0,0,0.06)` | `rgba(0,0,0,0.40)` | `pre` block |
| `--shadow-lg`     | `0 8px 48px rgba(0,0,0,0.10)` | `0 8px 48px rgba(0,0,0,0.50)` | Card lift |
| `--font`          | `var(--font)` | (same) | System sans-serif stack |
| `--font-mono`     | `var(--font-mono)` | (same) | System mono stack |

## Contrast gotchas

- **`--accent` is the brand fill, NOT the readable accent.** `#6366f1`
  on white is 4.46:1 — just under WCAG-AA 4.5 for normal text. Use
  `var(--accent-text)` (which is pre-darkened for light mode) when the
  accent is the foreground colour. The site-nav CTA uses `#4f46e5` for
  the same reason.
- **`--green` light is `#166534`, not `#16a34a`.** The lighter green
  reads at 2.89:1 on white — below AA. The darker green hits ~7:1.
- **`--text-dim` was bumped during the F6 a11y baseline** to pass AA
  against the slightly-darker code-block bg on `/dist`.

If you add a new token, audit it with axe-core in both themes before
merging — the [accessibility doc](accessibility.md) describes the
audit script.

## Skeletonic Stylus underlay

The page stylesheet order in `<head>` is:

```html
<link rel="stylesheet" href="/shared/vendor/skeletonic/skeletonic.min.css">
<link rel="stylesheet" href="/shared/site-nav.css">
<link rel="stylesheet" href="/shared/theme.css">
```

[Skeletonic](https://github.com/sebastienrousseau/skeletonic-stylus)
provides typography, focus rings, reduced-motion guards, and a small
set of utility classes. It also uses `light-dark()` natively. Our
`theme.css` re-declares the tokens with explicit values so we control
the final cascade (see the section above on why we don't rely on
`color-scheme` inheritance alone).

The vendored CSS is pinned via the `@sebastienrousseau/skeletonic-stylus`
npm package and refreshed by `npm run build:skeletonic` — see
`scripts/build-skeletonic.mjs`.
