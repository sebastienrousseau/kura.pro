# cloudcdn-rate-limiter

Standalone Cloudflare Worker that hosts the `RateLimiterDO` Durable Object class for the `cloudcdn-pro` Pages project.

## Why this exists

Cloudflare Pages Functions **cannot host Durable Object classes**. The `[[migrations]]` directive that provisions a DO namespace is Workers-only and the Pages git-integration deploy ignores it. So to use a DO from Pages you need a separate Worker that:

1. Exports the DO class.
2. Carries the `[[migrations]]` declaration in its own `wrangler.toml`.
3. Gets `wrangler deploy`ed once to provision the namespace.

After that, the Pages project binds to this Worker's DO via `script_name` in the repo-root `wrangler.toml`.

The DO source itself lives at [`../../functions/api/rate_limiter_do.js`](../../functions/api/rate_limiter_do.js) and is re-exported by [`src/index.js`](src/index.js) — exactly one source of truth.

## One-time activation

From this directory:

```sh
npx wrangler deploy
```

That command provisions the DO namespace (runs the `v1` migration) and uploads the Worker script. Subsequent deploys are migration no-ops.

Then add the binding to the repo-root `wrangler.toml`:

```toml
[[durable_objects.bindings]]
name        = "RATE_LIMITER"
class_name  = "RateLimiterDO"
script_name = "cloudcdn-rate-limiter"
```

Commit + push that change. The Pages deploy picks up the binding; `functions/api/_shared.js#checkRateLimit` already auto-detects `env.RATE_LIMITER` and routes through the DO when present — no application code change required.

## Rollback

Remove the `[[durable_objects.bindings]]` stanza from the repo-root `wrangler.toml`. The auto-detect path in `checkRateLimit` immediately reverts to the (fail-open) KV path. The Worker and its DO can stay deployed; idle DOs cost nothing.

## Local dev / inspection

```sh
npx wrangler dev   # local DO sandbox
npx wrangler tail  # stream live logs from the deployed Worker
```

This Worker has no external HTTP surface — the `fetch` handler just returns a static JSON status message for drive-by probes. The DO is reached only via the Pages cross-script binding.
