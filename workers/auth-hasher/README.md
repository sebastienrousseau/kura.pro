# cloudcdn-auth-hasher

Standalone Cloudflare Worker that runs **Argon2id** password hashing for
the `cloudcdn-pro` Pages project. Called only via the Pages cross-script
service binding `AUTH_HASHER`; there is no public HTTP route.

## Why standalone

Pages Functions inherit the Free-plan 10 ms CPU budget per request.
Argon2id at OWASP-recommended params (m=64 MiB, t=3, p=1) runs in
~80-120 ms. Running it in the Pages worker would either fail with CPU
exceeded or force the whole Pages project onto longer CPU limits (and
inflate every other request's billing baseline). Isolating it into a
separate Worker keeps the Pages CPU profile clean and the password
material off any public HTTP surface.

## Deploy (one-time)

```bash
cd workers/auth-hasher
npm install
npx wrangler login            # if not already authenticated
npx wrangler deploy
```

Then bind it into the Pages project by uncommenting the
`[[services]]` block in the repo-root `wrangler.toml`:

```toml
[[services]]
binding     = "AUTH_HASHER"
service     = "cloudcdn-auth-hasher"
environment = "production"
```

Verify with a direct probe:

```bash
curl https://cloudcdn-auth-hasher.<your-account>.workers.dev/health
```

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET`  | `/health` | — | `{ status: "ok", … }` |
| `POST` | `/hash`   | `{ password }` (1-1024 chars) | `{ hash }` — PHC-format Argon2id string |
| `POST` | `/verify` | `{ password, hash }` | `{ valid: boolean }` |

`/verify` is constant-time within the Argon2 library and never throws on
malformed input — a parse error returns `{ valid: false }`.

## From the Pages worker

```js
const res = await env.AUTH_HASHER.fetch("https://auth-hasher.internal/hash", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});
const { hash } = await res.json();
```

Service-binding requests don't hit the public network — the hostname is
ignored and the call is dispatched directly between workers.

## Plan requirement

**Workers Paid** ($5/mo base). Free-plan CPU limits will fail on every
hash call. The Pages project must already be on Paid for the existing
middleware to function under load, so this isn't a new cost.
