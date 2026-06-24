#!/usr/bin/env node
/**
 * Sync the BLOCKED_UA_PATTERNS array in functions/api/transform.js
 * against the upstream community-maintained AI-crawler registry.
 *
 * Upstream: https://github.com/ai-robots-txt/ai.robots.txt
 *           (158+ AI crawler operators as of 2026-06)
 *
 * Why this exists
 * ---------------
 * Hand-curated UA blocklists go stale fast — new AI agents launch
 * weekly. This script compares our local list to the upstream
 * registry and surfaces crawlers we don't yet block. Run by a weekly
 * CI workflow (.github/workflows/sync-ua-blocklist.yml); also
 * runnable on demand:
 *
 *   node scripts/sync-ua-blocklist.mjs                # human-readable report
 *   node scripts/sync-ua-blocklist.mjs --json         # JSON for CI
 *   node scripts/sync-ua-blocklist.mjs --check        # exit 1 if drift
 *
 * Why we don't auto-PR
 * --------------------
 * UA blocking has real false-positive risk (see audit notes in
 * transform.js — /oBot/i would match Roboto, /Gemini/i would match
 * apps named Gemini). New entries need a human reviewing whether
 * the regex source is specific enough. CI surfaces the diff; a
 * developer reviews + adds patterns by hand.
 */

import { parseArgs } from "node:util";
import { BLOCKED_UA_PATTERNS } from "../functions/api/transform.js";

const UPSTREAM = "https://raw.githubusercontent.com/ai-robots-txt/ai.robots.txt/main/robots.json";

/**
 * Pure — returns the set of upstream crawler names not covered by our
 * local pattern list. Exported for unit tests.
 *
 * Match is case-insensitive substring: upstream "GPTBot" is "covered"
 * if any local pattern's source contains "GPTBot" (or vice-versa).
 * Errors on the side of "not new" — if a local broader pattern catches
 * an upstream entry, we report it as covered.
 */
export function diffAgainstUpstream(upstreamNames, localPatterns) {
  const localSources = localPatterns.map((r) =>
    r.source.replace(/\\/g, "").toLowerCase(),
  );
  const missing = [];
  for (const name of upstreamNames) {
    const lc = name.toLowerCase();
    const covered = localSources.some(
      (src) => src.includes(lc) || lc.includes(src),
    );
    if (!covered) missing.push(name);
  }
  return missing;
}

/* v8 ignore start — IO path, exercised by manual rehearsal + CI. */
async function fetchUpstreamRegistry() {
  const res = await fetch(UPSTREAM, {
    headers: { "User-Agent": "cloudcdn.pro-sync-ua-blocklist (+https://cloudcdn.pro)" },
  });
  if (!res.ok) throw new Error(`upstream returned ${res.status}`);
  return res.json();
}

async function main() {
  const { values } = parseArgs({
    options: {
      json:  { type: "boolean", default: false },
      check: { type: "boolean", default: false },
    },
  });

  const registry = await fetchUpstreamRegistry();
  const upstreamNames = Object.keys(registry);
  const missing = diffAgainstUpstream(upstreamNames, BLOCKED_UA_PATTERNS);

  if (values.json) {
    console.log(JSON.stringify({
      upstreamSource: UPSTREAM,
      upstreamCount: upstreamNames.length,
      localCount: BLOCKED_UA_PATTERNS.length,
      missingCount: missing.length,
      missing: missing.map((name) => ({
        name,
        operator: registry[name]?.operator || "Unknown",
        function: registry[name]?.function || "",
        description: (registry[name]?.description || "").slice(0, 200),
        suggestedPattern: `/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/i`,
      })),
    }, null, 2));
  } else {
    console.log(`upstream:  ${upstreamNames.length} entries (${UPSTREAM})`);
    console.log(`local:     ${BLOCKED_UA_PATTERNS.length} patterns`);
    console.log(`missing:   ${missing.length}\n`);
    if (missing.length === 0) {
      console.log("✓ No drift — local blocklist is up to date.");
    } else {
      console.log("Candidates to consider adding (review carefully — broad patterns can false-positive):\n");
      for (const name of missing) {
        const op = registry[name]?.operator || "Unknown";
        const fn = registry[name]?.function || "";
        console.log(`  /${name}/i  — ${op}${fn ? ` (${fn})` : ""}`);
      }
      console.log(`\nFull JSON: ${UPSTREAM}`);
    }
  }

  if (values.check && missing.length > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
/* v8 ignore stop */
