# Accessibility

CloudCDN is built to WCAG 2.2 AA. Every page we own is **zero serious
or critical axe-core violations** in both light and dark themes, and
the audit is a **blocking CI gate** on every PR.

## What's audited

The `.github/workflows/test.yml` `accessibility` job runs axe-core
with the `wcag2a + wcag2aa + wcag22aa` rule set against:

- `/cdn/en/index.html`         — homepage
- `/cdn/en/dashboard/index.html` — asset dashboard

The job fails on any **serious** or **critical** violation. Moderate
and minor findings are logged but don't gate.

To run the same sweep locally against every page (not just the two CI
audits), start a local server and:

```bash
# in a separate terminal
(cd cdn && python3 -m http.server 8788)

# then
node scripts/tests/a11y-baseline.mjs   # custom sweep across all pages
```

(Script not committed — copy from this codebase's git history if you
need it. The same logic also runs ad-hoc during PR review.)

## Concrete commitments

- **WCAG 2.2 AA contrast** on every interactive — headings use
  `--accent-text` (pre-darkened for light mode); the primary CTA uses
  `#4f46e5` because the brand `--accent #6366f1` lands at 4.46:1 against
  white, just under AA.
- **Keyboard-first** — every focusable element has a `:focus-visible`
  ring (`outline: 2px solid var(--accent-text); outline-offset: 2px`).
  Skip-links are screen-reader-only until focused, then become visible
  at the top of the viewport.
- **Reduced motion** — every transition and animation is wrapped in
  `@media (prefers-reduced-motion: reduce) { transition: none !important;
  animation: none !important; }`. The orb pulse, message-in
  animations, chat-window slide, etc. all disable.
- **Form labels** — every input/select has either an associated
  `<label for="">` or `aria-label`. The dashboard's eight transform
  panel inputs (`tf-w`, `tf-h`, …) carry explicit `for=""` after the
  F6 fix.
- **ARIA semantics** — `aria-current="page"` on the nav's active link,
  `aria-live="polite"` on the stats bar, `role="region"` on the
  client-libraries subbar, `aria-pressed` on the theme toggle.
- **Touch targets** — every interactive is at least 2.75rem × 2.75rem
  (44 × 44 px) on `< 860 px` viewports. The site-nav enforces this on
  every link and button.
- **Logical properties** for RTL — `inset-inline-start` /
  `inset-inline-end` everywhere it matters; `dir="rtl"` on `ar` and
  `he` locale pages.

## Why third-party widgets are not gated

The Scalar API explorer on `/api-reference` ships its own ARIA semantics
that surface some axe-core violations (`aria-allowed-attr`,
`aria-required-children`, `scrollable-region-focusable`, plus its own
contrast issues). These are inside `<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference">`
— we don't control the markup. We track them in the audit output but
don't gate the build on them; fixing them requires forking Scalar or
waiting for upstream.

The Scalar widget's dark mode is bridged to the site-wide
`[data-theme]` via `/shared/scalar-theme.js` (see
[`mcp/README.md`](../mcp/README.md) for the bridge pattern) so the
page chrome at least flips with the user's preference.

## How a11y violations get caught

Three independent backstops:

1. **CI gate (every PR)** — axe-core on homepage + dashboard, both
   themes via the test-yml's `accessibility` job. Blocks merge on
   serious / critical.
2. **Local pre-merge** — `npm test` exercises the theme system itself
   (`scripts/tests/theme-boot.test.js`, `theme-toggle.test.js`,
   `scalar-theme.test.js` in `happy-dom`) — these don't run axe but
   they catch DOM-level regressions in the theme attribute, button
   state, persistence, etc.
3. **Code review** — token changes in `cdn/shared/theme.css` and
   `cdn/shared/site-nav.css` go through `gh pr review` with the
   contrast table in [`theming.md`](theming.md) as the reference.

## Past regressions (lessons)

- **F6 (PR #29)**: the original `--text-dim` was `#8b8fa3` /
  `#5b5f73` — palette-swapped from `--text-muted`, both giving ~3:1.
  Below AA. Bumped to `#62657a` / `#9da1b5` for ~5:1 against the page
  bg AND ~4.9:1 against the slightly-darker `--code-block-bg` on
  `/dist`.
- **F6 (PR #29)**: `.nav-cta` background was `var(--accent)` (`#6366f1`)
  giving white-on-indigo at 4.46:1 — just below AA. Swapped to
  `#4f46e5`; hover restores the brand fill.
- **PR #34 dashboard**: the body inherited `text-gray-200` for both
  themes, invisible on the white light-mode bg. Switched to
  `text-gray-900 dark:text-gray-200` (Tailwind dark variant driven by
  `[data-theme]` via `@custom-variant`).
- **PR #34 dashboard transform panel**: eight `<label>` elements
  lacked `for=""` — axe-core's `label` rule flagged five critical
  violations. Each `<label>` now references its input by id.

When you make a token / colour / nav-style change, run the audit
locally before merging — the lesson from these regressions is that
contrast is fragile and audit-by-eye doesn't catch the 3-4.5 band.
