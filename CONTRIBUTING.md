# Contributing to CloudCDN

Thanks for your interest in improving CloudCDN. This guide covers the workflow contributors need to know to land a change.

## Before you start

- Open or comment on an issue describing the change. For larger work, agreement on the approach up front saves wasted code.
- Search the repo for similar prior work; many areas have established conventions.
- Read [`ARCHITECTURE.md`](ARCHITECTURE.md) for the system layout, and [`SECURITY.md`](SECURITY.md) for the disclosure path if your change touches sensitive surfaces.

## Local setup

```bash
git clone git@github.com:sebastienrousseau/cloudcdn.pro.git
cd cloudcdn.pro
npm ci
```

Useful commands:

```bash
npm test                # run the full unit/integration suite
npm run test:coverage   # with v8 coverage; 100% gate on selected files
npm run test:visual     # Playwright visual regression
npm run build:manifest  # regenerate manifest.json + path typedefs
npm run build:css       # rebuild dashboard Tailwind output
```

A local Cloudflare runtime is available via `wrangler pages dev .` if you have `wrangler` installed.

## Branching and commits

- Branch off `main`. Use a topical prefix: `feat/...`, `fix/...`, `chore/...`, `docs/...`.
- Keep each commit a single logical unit. Mechanical refactors live in their own commit so `git blame` stays useful.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope): subject`, optional body, optional footer.
- **All commits must be cryptographically signed** (GPG or SSH). The deploy workflow rejects unsigned commits — see [`SECURITY.md`](SECURITY.md) for setup.
- The global commit-msg hook auto-attaches an `Assisted-by:` trailer per the Linux kernel coding-assistants standard when an AI agent helped with the change. Do not edit this trailer by hand.

## Tests

- New behaviour ships with new tests in the same PR. No "tests in the next PR".
- Unit tests live alongside their target under `scripts/tests/<area>.test.js`.
- The files listed under `coverage.include` in `vitest.config.js` are gated at **100%** statements/branches/functions/lines. If you add a new endpoint to that list, you own the coverage debt.
- For SSE or streaming responses, add a golden-file or shape assertion — drift is otherwise silent.

## Pull requests

A good PR description includes:

```
## Summary
- One line per change, in plain English

## Test plan
- [ ] commands you ran, with results
- [ ] new tests added or updated
- [ ] manual verification steps for anything not covered by tests
```

Keep PRs small. If your change spans more than ~500 LOC, look for a way to split it.

## What we look for in review

- Correctness, including edge cases at the HTTP boundary (path traversal, malformed JSON, missing headers, oversized inputs).
- Performance on hot paths — the codebase uses isolate-scoped caches and zero-allocation patterns; new code should not regress those.
- Observability — every new endpoint emits structured logs and propagates the trace ID.
- Backwards compatibility on the public API — see the API versioning policy in [`README.md`](README.md).
- No new dependencies without a written rationale.

## What not to send

- Bulk mechanical reformatting unless agreed up front.
- Changes that mix unrelated fixes.
- Changes that introduce a feature flag or backwards-compatibility shim where a clean replacement would do.
- Generated artefacts (`manifest.json`, `cloudcdn-paths.d.ts`, `coverage/`) — these regenerate from source and should never be hand-edited.

## Adding a package to the `/dist/` marketplace

The Setapp-style discovery surface at https://cloudcdn.pro/dist/ is driven by a hand-curated catalogue:

- **Source of truth**: [`scripts/dist/packages-catalogue.json`](scripts/dist/packages-catalogue.json) — every published package, hand-edited.
- **Generated artefact**: [`cdn/en/dist/_dist.json`](cdn/en/dist/_dist.json) — version-augmented output the marketplace page reads.
- **Generator**: [`scripts/dist/generate-dist-catalogue.mjs`](scripts/dist/generate-dist-catalogue.mjs) — fetches the latest version from every declared registry in parallel.
- **Refresh**: a Monday-morning cron at [`.github/workflows/cron-refresh-dist.yml`](.github/workflows/cron-refresh-dist.yml) re-runs the generator weekly and opens a PR if any version drifted. You can also trigger it manually from Actions → "Refresh /dist/ marketplace catalogue" → Run workflow.

### Adding a new package — 5-minute flow

1. **Open `scripts/dist/packages-catalogue.json`** and append a new entry to `packages[]`. The minimal shape:

   ```jsonc
   {
     "name": "Display Name",            // What the card shows
     "slug": "kebab-case",              // Stable internal id; must be unique
     "category": "cli",                 // One of categories[].id
     "tagline": "<=160 chars, one line",
     "repo": "sebastienrousseau/foo",   // GitHub repo (for the "Source ↗" link)
     "logo": "/foo/v1/logos/foo.svg",   // Optional; falls back to initials
     "registries": [
       { "type": "npm",             "name": "foo" },
       { "type": "crates.io",       "name": "foo" },
       { "type": "pypi",            "name": "foo" },
       { "type": "github-releases", "repo": "owner/foo" }
     ],
     "install": {
       // OS-aware install picker order:
       //   macos:   ['macos','npx','pipx','cargo install','cargo','pip','npm','pnpm']
       //   linux:   ['linux','npx','pipx','cargo install','cargo','pip','npm','pnpm']
       //   windows: ['windows','npx','cargo install','cargo','pip','pipx','npm','pnpm']
       "npm":  "npm install foo",
       "pnpm": "pnpm add foo"
     }
   }
   ```

2. **Add a logo** at `clients/<slug>/v1/logos/<slug>.svg` if you have one, otherwise omit `logo` and the card will render initials.

3. **Run the generator** to update the on-disk output:

   ```bash
   node scripts/dist/generate-dist-catalogue.mjs
   ```

   The script prints a warning for any package that has no live version on any declared registry.

4. **Run the tests**:

   ```bash
   npx vitest run scripts/tests/dist-catalogue.test.js
   ```

   The structural-invariant tests enforce: unique slugs, valid category refs, every package has at least one registry of a known type, every package has at least one install command, taglines ≤ 160 chars.

5. **Commit** `packages-catalogue.json` + `_dist.json` + the logo together. Don't hand-edit `_dist.json` — re-run the generator.

### Editing categories

To add a category, append to `categories[]` in `packages-catalogue.json`. The marketplace page renders sections in the order they appear there.

### Featuring a package on the hero

Set `"featured": "<slug>"` at the top of `packages-catalogue.json`. Whatever you pick is rendered as the big hero card above the category grids.

## Code of conduct

Participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). By contributing you agree to abide by it.

## License

Contributions are accepted under the project's dual MIT / Apache-2.0 license. By submitting a change you certify that you have the right to license it under those terms.
