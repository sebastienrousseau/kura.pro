#!/usr/bin/env node
/**
 * Stratos — official CloudCDN CLI (v0.1.0).
 *
 * Cross-platform single-file Node.js script. Requires Node ≥ 18 for the
 * built-in fetch and crypto.subtle APIs.
 *
 * Authentication: reads CLOUDCDN_ACCOUNT_KEY or CLOUDCDN_ACCESS_KEY from
 * the environment. Per-command override available via --key=... .
 * Endpoint: defaults to https://cloudcdn.pro; override with CLOUDCDN_URL.
 *
 *   stratos version
 *   stratos health [--deep]
 *   stratos purge <url> [<url> ...]
 *   stratos purge --tag <tag> [<tag> ...]
 *   stratos purge --everything
 *   stratos signed <path> --expires <unix-seconds>
 *   stratos assets [--project=<name>] [--format=<ext>]
 *
 * Source: https://github.com/sebastienrousseau/cloudcdn.pro
 * License: MIT
 */

const VERSION = '0.1.0';

// Read every config knob on each call so tests can override
// process.env per-test without having to re-import the module.
function envConfig() {
  return {
    BASE: process.env.CLOUDCDN_URL || 'https://cloudcdn.pro',
    ACCOUNT_KEY: process.env.CLOUDCDN_ACCOUNT_KEY || '',
    ACCESS_KEY: process.env.CLOUDCDN_ACCESS_KEY || '',
    SIGNED_URL_SECRET: process.env.SIGNED_URL_SECRET || '',
  };
}

function usage(exitCode = 0) {
  const out = `stratos v${VERSION} — CloudCDN CLI

Usage: stratos <command> [options]

Commands:
  version              Print the CLI version and exit.
  health [--deep]      Hit /api/health; --deep exercises every binding.
  purge <url>...       Invalidate one or more URLs (must start with the
                       CDN origin). Requires CLOUDCDN_ACCOUNT_KEY.
  purge --tag <tag>... Invalidate by Cache-Tag.
  purge --everything   Wipe the entire edge cache. Hard-rate-limited.
  signed <path>        Print an HMAC-signed URL for a private asset.
                         --expires <unix-seconds>   when the URL stops working
                         --secret <key>             override SIGNED_URL_SECRET
  assets               List the asset catalog (paginated).
                         --project=<name>           filter by project/zone
                         --format=<ext>             filter by file extension
                         --page=<n>                 page number (1-based)

Environment:
  CLOUDCDN_URL          API base URL (default https://cloudcdn.pro)
  CLOUDCDN_ACCOUNT_KEY  AccountKey header for control-plane operations
  CLOUDCDN_ACCESS_KEY   AccessKey header for read-only operations
  SIGNED_URL_SECRET     HMAC secret for 'signed' command

Examples:
  stratos health --deep
  stratos purge https://cloudcdn.pro/akande/v1/logos/logo.svg
  stratos signed /clients/akande/private.pdf --expires 1700000000
`;
  process.stdout.write(out);
  process.exit(exitCode);
}

function parseFlags(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = args[i + 1];
        if (next === undefined || next.startsWith('--')) {
          flags[key] = true;
        } else {
          flags[key] = next;
          i++;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function err(msg, code = 1) {
  process.stderr.write(`stratos: ${msg}\n`);
  process.exit(code);
}

async function jsonReq(path, init = {}) {
  const { BASE, ACCOUNT_KEY, ACCESS_KEY } = envConfig();
  const url = BASE.replace(/\/$/, '') + path;
  const headers = { Accept: 'application/json', ...(init.headers || {}) };
  if (ACCOUNT_KEY) headers.AccountKey = ACCOUNT_KEY;
  if (ACCESS_KEY) headers.AccessKey = ACCESS_KEY;
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function cmdHealth(flags) {
  const deep = flags.deep ? '?deep=1' : '';
  const { ok, status, body } = await jsonReq('/api/health' + deep);
  process.stdout.write(JSON.stringify(body, null, 2) + '\n');
  if (!ok) process.exit(status >= 500 ? 2 : 1);
}

async function cmdPurge(positional, flags) {
  const { ACCOUNT_KEY } = envConfig();
  if (!ACCOUNT_KEY) err('CLOUDCDN_ACCOUNT_KEY (or x-api-key via PURGE_KEY) is required for purge.', 1);
  let payload;
  if (flags.everything) {
    payload = { purge_everything: true };
  } else if (flags.tag) {
    const tags = Array.isArray(flags.tag) ? flags.tag : [flags.tag, ...positional];
    payload = { tags };
  } else {
    if (positional.length === 0) err('purge needs at least one URL, --tag, or --everything.', 1);
    payload = { urls: positional };
  }
  const { ok, status, body } = await jsonReq('/api/purge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ACCOUNT_KEY },
    body: JSON.stringify(payload),
  });
  process.stdout.write(JSON.stringify(body, null, 2) + '\n');
  if (!ok) process.exit(status >= 500 ? 2 : 1);
}

async function cmdSigned(positional, flags) {
  const { BASE, SIGNED_URL_SECRET } = envConfig();
  if (positional.length === 0) err('signed needs a path argument.', 1);
  const path = positional[0];
  const expires = flags.expires;
  if (!expires) err("signed needs --expires <unix-seconds>.", 1);
  const secret = flags.secret || SIGNED_URL_SECRET;
  if (!secret) err('SIGNED_URL_SECRET (or --secret) is required.', 1);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const data = `${path}|${expires}`;
  const sigBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  let hex = '';
  for (const b of sigBytes) hex += b.toString(16).padStart(2, '0');

  const url = `${BASE.replace(/\/$/, '')}/api/signed?path=${encodeURIComponent(path)}&expires=${encodeURIComponent(expires)}&sig=${hex}`;
  process.stdout.write(url + '\n');
}

async function cmdAssets(flags) {
  const params = new URLSearchParams();
  if (flags.project) params.set('project', flags.project);
  if (flags.format) params.set('format', flags.format);
  if (flags.page) params.set('page', flags.page);
  const path = '/api/assets' + (params.toString() ? '?' + params.toString() : '');
  const { ok, status, body } = await jsonReq(path);
  process.stdout.write(JSON.stringify(body, null, 2) + '\n');
  if (!ok) process.exit(status >= 500 ? 2 : 1);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help' || argv[0] === 'help') usage(0);

  const [cmd, ...rest] = argv;
  const { positional, flags } = parseFlags(rest);

  switch (cmd) {
    case 'version':
    case '-v':
    case '--version':
      process.stdout.write(`stratos v${VERSION}\n`);
      return;
    case 'health':
      return cmdHealth(flags);
    case 'purge':
      return cmdPurge(positional, flags);
    case 'signed':
      return cmdSigned(positional, flags);
    case 'assets':
      return cmdAssets(flags);
    default:
      err(`unknown command: ${cmd}. Run "stratos help" for usage.`, 1);
  }
}

// Exports for unit testing. When this module is loaded as a script
// (not imported), main() runs and the process exits via its handlers;
// when imported (process.argv[1] !== this file), exports are usable.
export { parseFlags, cmdHealth, cmdPurge, cmdSigned, cmdAssets, jsonReq, main, VERSION };

// Run main() only when invoked as a script. Compare the resolved
// filesystem path of this module against process.argv[1]; basename
// matching is too loose under vitest (which sets argv[1] = 'stratos.mjs'
// from the test harness, causing a false positive).
/* v8 ignore start -- script entrypoint; never true under vitest */
const { fileURLToPath } = await import('node:url');
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => err(e && e.message ? e.message : String(e), 2));
}
/* v8 ignore stop */
