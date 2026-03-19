# CloudCDN — Troubleshooting

## Asset Not Loading (404)

### Symptom
`https://cloudcdn.pro/project/image.webp` returns 404.

### Common Causes
1. **File not pushed yet.** Check `git status` — is the file committed and pushed?
2. **Deploy still in progress.** GitHub Actions deploy takes 30-90 seconds. Check the Actions tab.
3. **Wrong path.** URLs are case-sensitive. `Logo.webp` is not `logo.webp`.
4. **WebP/AVIF not generated yet.** Auto-conversion runs on push. If you pushed a PNG, the `.webp` and `.avif` variants appear after the compress-images Action completes.
5. **File over 25 MB.** Files exceeding 25 MB are excluded from CDN delivery. Check file size with `ls -lh`.

### Fix
```bash
# Verify file exists in repo
git ls-files | grep your-file

# Check Actions status
gh run list --limit 5

# Test URL directly
curl -sI https://cloudcdn.pro/project/images/logo.webp
```

## Commit Signing Fails

### Symptom
```
error: Signing failed: agent refused operation
```

### Common Causes
1. **SSH agent not running.** Start it:
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```
2. **Hardware key not touched.** If using a YubiKey or security key (Ed25519-SK), tap the key when prompted.
3. **Wrong signing key configured.** Verify:
   ```bash
   git config --global user.signingkey
   ```
4. **SSH key not added to GitHub.** Go to GitHub → Settings → SSH and GPG keys. Ensure your key is listed as a **Signing Key** (not just Authentication).

## WebP/AVIF Not Generated

### Symptom
You pushed a PNG but no `.webp` or `.avif` variant appeared.

### Common Causes
1. **Compress Action didn't trigger.** The workflow only triggers on new PNG/JPEG files. If the file already existed, it won't re-process. Check Actions tab.
2. **File not detected as new.** The workflow uses `git diff HEAD~1` to find new files. If you amended a commit, the diff may not detect it.
3. **Sharp conversion failed.** Some malformed PNGs or unusual color profiles can cause conversion errors. Check the Action logs.

### Fix
Run the local conversion script manually:
```bash
cd scripts && npm install
node convert.mjs ../your-project
```

## Stale Content After Push

### Symptom
You pushed an updated image but the old version still serves.

### Cause
Assets are cached with `immutable` headers for 1 year. Updating a file at the same URL won't invalidate caches.

### Fix
**Change the filename or path.** This is by design — immutable caching is the fastest delivery strategy.
```bash
# Instead of updating logo.png, use versioned names:
logo-v2.png
# Or date-based:
logo-2026-03.png
```

Pro/Enterprise customers can purge specific URLs via the Cloudflare dashboard.

## Deploy Fails (GitHub Actions)

### Symptom
The "Deploy to Cloudflare Pages" Action fails.

### Common Causes
1. **Invalid API token.** Token may have expired or been rolled. Update `CLOUDFLARE_API_TOKEN` in GitHub Secrets.
2. **Missing permissions.** The token needs: Cloudflare Pages Edit, Workers Scripts Edit, Vectorize Edit, Workers KV Storage Edit, Workers AI Read.
3. **File over 25 MB.** The deploy workflow auto-removes files >25 MB, but check the logs for errors.
4. **Cloudflare service issue.** Check cloudflarestatus.com.

### Fix
```bash
# Re-run the failed workflow
gh run rerun <run-id>

# Check the logs
gh run view <run-id> --log-failed
```

## Manifest Not Updating

### Symptom
New assets don't appear in `manifest.json` or the dashboard.

### Cause
The manifest generator triggers on image path changes. If you pushed files outside the expected paths, it may not trigger.

### Fix
Trigger manually:
```bash
gh workflow run generate-manifest.yml
```
Or regenerate locally:
```bash
node scripts/generate-manifest.mjs
git add manifest.json
git commit -S -m "update manifest"
git push
```

## Bandwidth Limit Reached (Free Tier)

### Symptom
Assets return errors or stop loading mid-month.

### Cause
Free tier has 10 GB/month bandwidth. You'll receive an email at 80% usage.

### Fix
- Optimize images further (use AVIF URLs instead of PNG for ~70% reduction).
- Upgrade to Pro ($29/mo) for 100 GB/month.
- Wait for the next month — limits reset on the 1st.

## Concierge Chat Not Responding

### Symptom
The AI chat widget on the homepage doesn't respond or shows errors.

### Common Causes
1. **Monthly query limit reached (1,000/month).** The Concierge disables itself when the limit is hit.
2. **Cloudflare Workers AI temporarily unavailable.** Rare, but edge AI inference can experience brief outages.
3. **Knowledge base not synced.** If content files were recently updated, the Vectorize index may need re-syncing.

### Fix
For knowledge sync issues:
```bash
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> node scripts/sync-knowledge.mjs content
```
