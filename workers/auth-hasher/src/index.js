// Module-worker entry for the cloudcdn-auth-hasher Worker.
//
// Sole purpose: run Argon2id (OWASP 2026 params: m=64 MiB, t=3, p=1)
// off the Pages worker so the Pages runtime's CPU budget isn't consumed
// by ~100 ms hashes on every signup / password verification.
//
// Called only via the Pages cross-script service binding `AUTH_HASHER`.
// There's no public HTTP path; the default fetch handler exists for
// drive-by probes and health checks only.
//
// Endpoints (internal, via service binding):
//   POST /hash      { password }          → { hash }
//   POST /verify    { password, hash }    → { valid: boolean }
//   GET  /health                          → { status: "ok" }

import { argon2id, argon2Verify } from "hash-wasm";

// OWASP Password Storage Cheat Sheet (2026): Argon2id m=64 MiB, t=3, p=1.
const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // KiB → 64 MiB
  hashLength: 32,
  outputType: "encoded", // PHC-format string
};

const MIN_PASSWORD_LEN = 1;
const MAX_PASSWORD_LEN = 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return argon2id({ ...ARGON2_PARAMS, password, salt });
}

async function verifyPassword(password, hash) {
  return argon2Verify({ password, hash });
}

async function handleHash(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { password } = body || {};
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
    return json({ error: `password required (${MIN_PASSWORD_LEN}-${MAX_PASSWORD_LEN} chars)` }, 400);
  }
  const hash = await hashPassword(password);
  return json({ hash });
}

async function handleVerify(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { password, hash } = body || {};
  if (typeof password !== "string" || typeof hash !== "string") {
    return json({ error: "password and hash both required" }, 400);
  }
  if (password.length > MAX_PASSWORD_LEN) {
    // A long submission against a short stored hash should not be allowed
    // to burn CPU just to fail. Reject early.
    return json({ valid: false }, 200);
  }
  let valid;
  try {
    valid = await argon2Verify({ password, hash });
  } catch {
    // Malformed PHC string, wrong algorithm — treat as a failed match
    // rather than leaking the parsing error to the caller.
    return json({ valid: false }, 200);
  }
  return json({ valid });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        status: "ok",
        worker: "cloudcdn-auth-hasher",
        purpose: "Argon2id password KDF for the cloudcdn-pro Pages project.",
        note: "Called via Pages cross-script service binding `AUTH_HASHER`.",
      });
    }

    if (request.method !== "POST") {
      return json({ error: "POST only", endpoints: ["POST /hash", "POST /verify", "GET /health"] }, 405);
    }

    if (url.pathname === "/hash") return handleHash(request);
    if (url.pathname === "/verify") return handleVerify(request);

    return json({ error: "not found", endpoints: ["POST /hash", "POST /verify", "GET /health"] }, 404);
  },
};
