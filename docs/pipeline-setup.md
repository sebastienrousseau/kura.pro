# Pipeline setup (`/api/pipeline`)

The `/api/pipeline` endpoint accepts a generated SVG and an optional list of derivative outputs (favicon, icons, banners), commits them into the repo via the GitHub Git Database API, and optionally purges the matching Cloudflare cache entries. It's the GitOps-driven way for integrators to ship new zones without touching the repo manually.

The endpoint is dormant by default. It returns:

```
501 Not Configured
Pipeline requires GITHUB_TOKEN and GITHUB_REPO environment variables.
Configure these in your Cloudflare Pages project settings.
```

This doc is the activation runbook.

## Prerequisites

You need:

1. **A GitHub fine-grained PAT** scoped to `sebastienrousseau/cloudcdn.pro` (or your fork). The token lives in Cloudflare's secret store; it never touches the repo.
2. **`wrangler` authenticated** to the Cloudflare account (`npx wrangler whoami` should show `Team Rousseau Account`).
3. **Optional**: a Cloudflare API token if you want post-commit cache purge. Without it the commit lands but the edge serves stale until the next CI deploy.

## Step 1 — Create the GitHub PAT

1. Go to <https://github.com/settings/personal-access-tokens/new>.
2. Choose **Fine-grained personal access token** (legacy classic tokens work too but bring more risk).
3. **Resource owner**: your account (`sebastienrousseau`).
4. **Repository access**: *Only select repositories* → check **`sebastienrousseau/cloudcdn.pro`**. Granting access to all repos is unnecessary blast radius.
5. **Repository permissions** — set only these:
   - **Contents**: `Read and write` (required — the endpoint creates blobs/trees/commits)
   - **Metadata**: `Read-only` (required, auto-selected)
6. **Expiry**: 1 year is fine for the first issuance; rotate annually. Add a calendar reminder.
7. Click **Generate token**. Copy the `github_pat_…` string immediately — GitHub will not show it again.

## Step 2 — Upload the PAT as a Pages secret

From the repo root:

```sh
# Paste the PAT when prompted; nothing is echoed back.
npx wrangler pages secret put GITHUB_TOKEN --project-name=cloudcdn-pro
```

You can verify the secret is stored (without revealing it) with:

```sh
npx wrangler pages secret list --project-name=cloudcdn-pro
# should now include: - GITHUB_TOKEN: Value Encrypted
```

`GITHUB_REPO` is already set as a plaintext var in `wrangler.toml` (`[vars]`), so no separate upload is required for that.

## Step 3 — (Optional) Cache purge credentials

To have the endpoint purge edge cache for each committed file synchronously:

```sh
# Find the zone ID at https://dash.cloudflare.com → cloudcdn.pro → Overview → "Zone ID"
npx wrangler pages secret put CLOUDFLARE_ZONE_ID --project-name=cloudcdn-pro

# Create a token at https://dash.cloudflare.com/profile/api-tokens with the
# "Zone.Cache Purge" permission scoped only to the cloudcdn.pro zone.
npx wrangler pages secret put CLOUDFLARE_API_TOKEN --project-name=cloudcdn-pro
```

Both are optional. Without them, the commit lands but the edge serves the previous bytes until normal Cache-Control expiry (or until the next deploy invalidates the bundle).

## Step 4 — Redeploy and verify

Pages secrets only bind to deployments created **after** the secret upload (existing deployments keep their pre-upload env snapshot). Trigger a fresh deploy:

```sh
gh workflow run "Deploy to Cloudflare Pages" --ref main
```

Wait for the run to finish, then verify:

```sh
# Should now return 401 (auth missing) instead of 501 (not configured)
curl -sI https://cloudcdn.pro/api/pipeline -X POST | head -1
# HTTP/2 401
```

## Step 5 — Smoke-test with a real call

The endpoint expects an `AccountKey` header (or a scoped Bearer token with `pipeline:write`). Use the same `ACCOUNT_KEY` you generated for `/api/core/zones`.

```sh
# Minimal payload — generates a zone called "demo" with no derivatives.
curl -sS https://cloudcdn.pro/api/pipeline \
  -X POST \
  -H "AccountKey: $ACCOUNT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "asset",
    "name": "demo",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"#0066cc\"/></svg>",
    "generateFavicon": false,
    "generateIcons": false,
    "generateBanners": false
  }' | jq .
```

Expected response shape:

```json
{
  "HttpCode": 200,
  "Commit": "abc123…",
  "Files": ["clients/demo/v1/logos/demo.svg"],
  "DateCreated": "2026-…"
}
```

Check the commit landed in GitHub (`git log` on `main`) and that the file is reachable at the edge after the next deploy.

## Rotation

When the PAT is approaching expiry:

1. Generate a new one with the same scopes (Step 1).
2. Run `npx wrangler pages secret put GITHUB_TOKEN` again — overwrites the old value.
3. Redeploy (Step 4).
4. Delete the old PAT in <https://github.com/settings/tokens> once the new one is verified working.

## Disabling

To turn the endpoint back off:

```sh
npx wrangler pages secret delete GITHUB_TOKEN --project-name=cloudcdn-pro
```

The endpoint returns to the 501 NotConfigured response on the next deploy. The `GITHUB_REPO` var can stay — it's harmless without the token.
