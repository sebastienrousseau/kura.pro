/**
 * OAuth 2.0 helpers shared by /api/auth/oauth/<provider>/{begin,callback}.
 *
 * Three providers in this PR: google, github, apple. Each is configured
 * via PROVIDERS below — adding a fourth is one entry + an env-var pair.
 *
 * Flow:
 *   1. /api/auth/oauth/<p>/begin       generates a random `state`, stores
 *                                       it in RATE_KV with a 10-min TTL,
 *                                       redirects the browser to the
 *                                       provider's authorisation URL.
 *   2. provider                         redirects back to
 *      /api/auth/oauth/<p>/callback?code=…&state=…
 *   3. callback                         validates state (consumes the KV
 *                                       entry), exchanges code for
 *                                       access token, fetches userinfo,
 *                                       find-or-creates User + Account
 *                                       + OAuthIdentity in D1, mints a
 *                                       session, redirects to /dashboard
 *                                       (existing users) or /onboarding
 *                                       (new users — with reveal cookie).
 *
 * No third-party OAuth library. The flow is conventional enough that
 * the small extra surface is preferable to pulling Arctic in for three
 * providers.
 */

import {
  uuid, getDB, hasAccountsDB, mintSession, createApiKey,
  sessionCookieHeader, loggedInIndicatorCookie,
  signRevealPayload, revealCookieHeader, auditEvent,
} from "./_lib.js";

// ── State store ──────────────────────────────────────────────────
//
// State is stored in RATE_KV under `oauth:state:<random>` with a 10-min
// TTL. Read-then-delete on callback so a state is single-use (CSRF
// defence). The KV write rate is sustainable: ~1 write per signup
// attempt is well under the documented Free-tier 1000 writes/day cap.

const STATE_TTL_SECONDS = 10 * 60;

export async function issueState(env, provider) {
  if (!env.RATE_KV) throw new Error("RATE_KV binding required for OAuth state");
  const state = bufferToBase64url(crypto.getRandomValues(new Uint8Array(24)));
  // adr: ADR-09 — OAuth CSRF state, 1 write per attempt, KV is the right
  // tier here (we need it readable by the callback PoP, not just hot
  // analytics; AE doesn't support lookups; DO is heavier than warranted).
  await env.RATE_KV.put(`oauth:state:${state}`, JSON.stringify({ provider, createdAt: Date.now() }), {
    expirationTtl: STATE_TTL_SECONDS,
  });
  return state;
}

export async function consumeState(env, state) {
  if (!env.RATE_KV || !state) return null;
  const raw = await env.RATE_KV.get(`oauth:state:${state}`);
  if (!raw) return null;
  // Delete first so a parallel replay loses the race.
  // adr: ADR-09 — consume-on-read, see issueState above.
  await env.RATE_KV.delete(`oauth:state:${state}`);
  try { return JSON.parse(raw); } catch { return null; }
}

// ── Provider configs ─────────────────────────────────────────────

export const PROVIDERS = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    extract: (profile) => ({
      providerUserId: String(profile.sub),
      email: profile.email,
      emailVerified: profile.email_verified !== false,
      name: profile.name || profile.given_name || null,
    }),
  },
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userinfoUrl: "https://api.github.com/user",
    scope: "read:user user:email",
    clientIdEnv: "GITHUB_OAUTH_CLIENT_ID",
    clientSecretEnv: "GITHUB_OAUTH_CLIENT_SECRET",
    extract: (profile) => ({
      providerUserId: String(profile.id),
      // primary verified email is fetched separately in fetchUserinfo
      email: profile._primary_verified_email || profile.email || null,
      emailVerified: !!profile._primary_verified_email,
      name: profile.name || profile.login || null,
    }),
  },
  apple: {
    authUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    userinfoUrl: null, // Apple returns id_token; no separate userinfo
    scope: "name email",
    responseMode: "form_post",
    clientIdEnv: "APPLE_OAUTH_CLIENT_ID",
    // Apple's "client secret" is actually a short-lived ES256 JWT we
    // sign on demand using the team/key/private-key triple. See
    // mintAppleClientSecret below; treat APPLE_OAUTH_CLIENT_SECRET as
    // unused for this provider.
    clientSecretEnv: null,
    appleTeamIdEnv: "APPLE_OAUTH_TEAM_ID",
    appleKeyIdEnv: "APPLE_OAUTH_KEY_ID",
    applePrivateKeyEnv: "APPLE_OAUTH_PRIVATE_KEY",
    extract: (profile) => ({
      // For Apple, profile is the parsed id_token payload.
      providerUserId: String(profile.sub),
      email: profile.email || null,
      emailVerified: profile.email_verified !== false,
      name: null, // Apple sends name only on FIRST consent, in form_post payload
    }),
  },
};

export function providerConfigured(env, provider) {
  const cfg = PROVIDERS[provider];
  if (!cfg) return false;
  if (!env[cfg.clientIdEnv]) return false;
  if (provider === "apple") {
    return !!(env[cfg.appleTeamIdEnv] && env[cfg.appleKeyIdEnv] && env[cfg.applePrivateKeyEnv]);
  }
  return !!env[cfg.clientSecretEnv];
}

// ── Authorisation URL construction ───────────────────────────────

export function buildAuthorizationUrl(env, provider, { state, redirectUri }) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`unknown provider: ${provider}`);
  const params = new URLSearchParams({
    client_id: env[cfg.clientIdEnv],
    redirect_uri: redirectUri,
    response_type: "code",
    scope: cfg.scope,
    state,
  });
  if (cfg.responseMode) params.set("response_mode", cfg.responseMode);
  // GitHub doesn't require but allows access_type / prompt; Google
  // benefits from prompt=select_account on multi-account devices.
  if (provider === "google") params.set("prompt", "select_account");
  return `${cfg.authUrl}?${params.toString()}`;
}

// ── Code exchange ────────────────────────────────────────────────

export async function exchangeCode(env, provider, { code, redirectUri }) {
  const cfg = PROVIDERS[provider];
  const body = new URLSearchParams({
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    client_id: env[cfg.clientIdEnv],
  });

  if (provider === "apple") {
    body.set("client_secret", await mintAppleClientSecret(env));
  } else if (cfg.clientSecretEnv) {
    body.set("client_secret", env[cfg.clientSecretEnv]);
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "cloudcdn.pro/0.1",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token exchange failed for ${provider}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Userinfo (or id_token decode for Apple) ──────────────────────

export async function fetchUserinfo(env, provider, tokenResponse) {
  const cfg = PROVIDERS[provider];

  if (provider === "apple") {
    // Apple returns userinfo embedded in id_token (JWT). Verify signature
    // optionally; for Phase 0 we trust the JWT (we just exchanged the
    // code over HTTPS with Apple's token endpoint and they signed it).
    const idToken = tokenResponse.id_token;
    if (!idToken) throw new Error("apple: id_token missing from token response");
    return decodeJwtPayload(idToken);
  }

  const res = await fetch(cfg.userinfoUrl, {
    headers: {
      Authorization: `Bearer ${tokenResponse.access_token}`,
      Accept: "application/json",
      "User-Agent": "cloudcdn.pro/0.1",
    },
  });
  if (!res.ok) {
    throw new Error(`userinfo fetch failed for ${provider}: ${res.status}`);
  }
  const profile = await res.json();

  // GitHub's primary email is often null on /user; fetch /user/emails
  // and pick the primary+verified one.
  if (provider === "github" && !profile.email) {
    try {
      const emails = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${tokenResponse.access_token}`,
          Accept: "application/json",
          "User-Agent": "cloudcdn.pro/0.1",
        },
      });
      if (emails.ok) {
        const list = await emails.json();
        const primary = list.find((e) => e.primary && e.verified) || list.find((e) => e.verified);
        if (primary) profile._primary_verified_email = primary.email;
      }
    } catch { /* leave email null; user will be prompted to add one */ }
  }

  return profile;
}

// ── Apple client-secret JWT ──────────────────────────────────────
//
// Apple requires the OAuth "client_secret" to be a short-lived ES256 JWT
// signed with a private key associated with the developer team. We mint
// one per code-exchange. TTL kept at 10 minutes — long enough for a
// retry, short enough that a leaked JWT becomes useless quickly.

async function mintAppleClientSecret(env) {
  const teamId = env.APPLE_OAUTH_TEAM_ID;
  const keyId = env.APPLE_OAUTH_KEY_ID;
  const clientId = env.APPLE_OAUTH_CLIENT_ID;
  const pkcs8Pem = env.APPLE_OAUTH_PRIVATE_KEY;
  /* v8 ignore next 3 — providerConfigured(env,'apple') gates every
     caller, so this throw is only reachable if someone calls this
     helper directly. Defensive backstop. */
  if (!teamId || !keyId || !clientId || !pkcs8Pem) {
    throw new Error("Apple OAuth not fully configured (need TEAM_ID + KEY_ID + CLIENT_ID + PRIVATE_KEY)");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: "ES256", kid: keyId, typ: "JWT" });
  const payload = base64urlJson({
    iss: teamId,
    iat: now,
    exp: now + 600,
    aud: "https://appleid.apple.com",
    sub: clientId,
  });
  const signingInput = `${header}.${payload}`;
  const key = await importApplePrivateKey(pkcs8Pem);
  const sigBuf = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bufferToBase64url(new Uint8Array(sigBuf))}`;
}

async function importApplePrivateKey(pem) {
  const pkcs8 = pemToBuffer(pem);
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

function pemToBuffer(pem) {
  const body = pem.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// ── User + Account provisioning from OAuth ───────────────────────

// Returns { user, account, created } where created indicates whether
// this OAuth login produced a fresh user (and thus a new account +
// default API key). For existing users (matched by provider/provider_
// user_id OR email), no new account is created and `created` is false.
export async function findOrCreateUserFromOAuth(env, { provider, providerUserId, email, name }) {
  const db = getDB(env);
  if (!email) {
    throw new Error(`${provider}: no email returned — cannot create account`);
  }

  // 1. Match by (provider, provider_user_id) — most stable identifier.
  const byOauth = await db
    .prepare(`SELECT user_id FROM oauth_identities WHERE provider = ?1 AND provider_user_id = ?2`)
    .bind(provider, providerUserId).first();
  if (byOauth) {
    const user = await db
      .prepare(`SELECT id, email, name, email_verified_at FROM users WHERE id = ?1 AND deleted_at IS NULL`)
      .bind(byOauth.user_id).first();
    if (user) {
      const account = await db
        .prepare(`SELECT id, name, plan, monthly_cap_usd FROM accounts WHERE owner_user_id = ?1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`)
        .bind(user.id).first();
      return { user, account, created: false };
    }
  }

  // 2. Match by email — link this OAuth identity to the existing user.
  const byEmail = await db
    .prepare(`SELECT id, email, name, email_verified_at FROM users WHERE lower(email) = lower(?1) AND deleted_at IS NULL`)
    .bind(email).first();
  if (byEmail) {
    await db
      .prepare(`INSERT OR IGNORE INTO oauth_identities (id, user_id, provider, provider_user_id, email) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(uuid(), byEmail.id, provider, providerUserId, email).run();
    const account = await db
      .prepare(`SELECT id, name, plan, monthly_cap_usd FROM accounts WHERE owner_user_id = ?1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`)
      .bind(byEmail.id).first();
    return { user: byEmail, account, created: false };
  }

  // 3. New user. Create user + account + membership + oauth_identity +
  //    default API key in a D1 batch. Mark email as verified — OAuth
  //    providers verify the email before issuing the token. (Skip Apple
  //    private-relay edge case for now; treat all OAuth emails as
  //    verified.)
  const userId = uuid();
  const accountId = uuid();
  const membershipId = uuid();
  const oauthId = uuid();
  const localPart = email.split("@")[0];
  const accountName = `${localPart}'s Account`;
  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db.prepare(`INSERT INTO users (id, email, name, email_verified_at) VALUES (?1, ?2, ?3, ?4)`)
      .bind(userId, email, name || null, now),
    db.prepare(`INSERT INTO accounts (id, owner_user_id, name) VALUES (?1, ?2, ?3)`)
      .bind(accountId, userId, accountName),
    db.prepare(`INSERT INTO memberships (id, user_id, account_id, role) VALUES (?1, ?2, ?3, 'owner')`)
      .bind(membershipId, userId, accountId),
    db.prepare(`INSERT INTO oauth_identities (id, user_id, provider, provider_user_id, email) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(oauthId, userId, provider, providerUserId, email),
  ]);

  const user = { id: userId, email, name, email_verified_at: now };
  const account = { id: accountId, name: accountName, plan: "free", monthly_cap_usd: 0 };
  return { user, account, created: true };
}

// ── Complete-callback helper: build the redirect response ────────
//
// Mirrors the cookie-setting pattern in functions/api/auth/signup.js so
// the OAuth happy path drops the user into the same /onboarding flow
// with the same reveal cookie semantics.

export async function completeCallback(env, { request, provider, user, account, created, returnTo }) {
  if (!hasAccountsDB(env)) throw new Error("ACCOUNTS_DB binding missing");
  const ip = request.headers.get("cf-connecting-ip") || null;
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 256);
  const { token, expiresAt } = await mintSession(env, {
    userId: user.id,
    accountId: account ? account.id : null,
    ip,
    userAgent,
  });

  const response = new Response(null, {
    status: 302,
    headers: { Location: returnTo },
  });
  response.headers.append("Set-Cookie", sessionCookieHeader(token, expiresAt));
  response.headers.append("Set-Cookie", loggedInIndicatorCookie(expiresAt));

  // For brand-new users, also mint an API key + reveal cookie so the
  // /onboarding wizard's Step 3 has something to display.
  if (created && account) {
    const apiKey = await createApiKey(env, { accountId: account.id, userId: user.id, name: "Default" });
    const revealSigned = await signRevealPayload(env, {
      userId: user.id,
      accountId: account.id,
      apiKeyId: apiKey.id,
      apiKeyPrefix: apiKey.prefix,
      apiKeyFullKey: apiKey.fullKey,
      apiKeyScopes: apiKey.scopes,
    });
    response.headers.append("Set-Cookie", revealCookieHeader(revealSigned));
    await auditEvent(env, { accountId: account.id, userId: user.id, action: "user.signup", request, meta: { via: `oauth:${provider}` } });
    await auditEvent(env, { accountId: account.id, userId: user.id, action: "apikey.create", request, meta: { keyId: apiKey.id, prefix: apiKey.prefix } });
  } else {
    await auditEvent(env, {
      accountId: account ? account.id : null,
      userId: user.id,
      action: "user.login",
      request,
      meta: { via: `oauth:${provider}` },
    });
  }
  return response;
}

// ── Utilities ────────────────────────────────────────────────────

export function bufferToBase64url(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(obj) {
  return bufferToBase64url(new TextEncoder().encode(JSON.stringify(obj)));
}

export function decodeJwtPayload(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("invalid JWT");
  const padded = parts[1] + "=".repeat((4 - parts[1].length % 4) % 4);
  const json = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json);
}

export function buildRedirectUri(request, provider) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/api/auth/oauth/${provider}/callback`;
}
