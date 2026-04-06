# CloudCDN — Security Guide

## Overview
CloudCDN enforces signed commits on all pushes to the main branch. This ensures every asset change is cryptographically verified and traceable to a specific contributor.

## Why Signed Commits?
- **Integrity:** Guarantees that assets haven't been tampered with in transit.
- **Audit Trail:** Every change is linked to a verified identity.
- **Supply Chain Security:** Prevents unauthorized modifications to CDN-served content.
- **Compliance:** Meets enterprise security requirements for asset provenance.

## SSH Key Setup (Recommended)

### Generate an Ed25519 Key
```bash
ssh-keygen -t ed25519 -C "your@email.com" -f ~/.ssh/id_ed25519
```

For hardware security keys (YubiKey, etc.):
```bash
ssh-keygen -t ed25519-sk -C "your@email.com"
```

### Configure Git
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Add Key to GitHub
1. Copy your public key: `cat ~/.ssh/id_ed25519.pub`
2. Go to GitHub → Settings → SSH and GPG keys → New SSH key
3. Select **Signing Key** as the key type
4. Paste and save

### Verify
```bash
echo "test" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n git
```

## GPG Key Setup (Alternative)

### Generate a GPG Key
```bash
gpg --full-generate-key
```
Select RSA 4096-bit, set an expiration, and enter your email.

### Configure Git
```bash
gpg --list-secret-keys --keyid-format=long
# Copy the key ID (e.g., 3AA5C34371567BD2)
git config --global user.signingkey 3AA5C34371567BD2
git config --global commit.gpgsign true
```

### Add Key to GitHub
```bash
gpg --armor --export 3AA5C34371567BD2
```
Copy the output and add it at GitHub → Settings → SSH and GPG keys → New GPG key.

## Branch Protection
The main branch is protected with the following rules:
- **Signed commits required:** All commits must be cryptographically signed.
- **No force pushes:** History cannot be rewritten.
- **No branch deletion:** The main branch cannot be deleted.

## API Token Security
For CI/CD workflows, API tokens are stored as GitHub Secrets:
- `CLOUDFLARE_API_TOKEN` — Used for Cloudflare Pages deployment.
- `CLOUDFLARE_ACCOUNT_ID` — Your Cloudflare account identifier.

Never commit API tokens, secrets, or credentials to the repository. Use GitHub Secrets for all sensitive values.

## Security Best Practices
1. Use hardware security keys (Ed25519-SK) when possible.
2. Rotate API tokens quarterly.
3. Review the GitHub audit log for unexpected access.
4. Enable two-factor authentication on your GitHub account.
5. Use the `git log --show-signature` command to verify commit signatures.
