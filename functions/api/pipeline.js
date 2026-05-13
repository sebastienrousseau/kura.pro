/**
 * Asset ingestion pipeline — single SVG upload generates a full asset scaffold.
 *
 * POST /api/pipeline
 * Auth: AccountKey (control-plane operation)
 *
 * Accepts JSON body with mode, name, svg (base64), and optional generation flags.
 * Creates logos, icons, and directory scaffolding via the GitHub Git Database API.
 */

import { authenticateAccount, errorResponse, jsonResponse, fetchWithTimeout, log, cdnOrigin } from './_shared.js';
import { authorizeWithScope } from './tokens.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'AccountKey, Content-Type',
  'Content-Type': 'application/json',
};

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'CloudCDN-Pipeline',
  };
}

// ── SVG sanitizer ──
//
// Defending against the regex-sanitizer bypass classes CodeQL warns
// about (`js/incomplete-multi-character-sanitization`, `js/bad-tag-filter`)
// means we don't write `.replace(/<script.../)` at all. Instead we walk
// the input string with indexOf + slice, drop boundaries we recognize as
// unsafe, and keep everything else verbatim. Three independent passes,
// each one a focused string-walk:
//
//   1. stripDisallowedTags  — removes <script>, <iframe>, <foreignObject>,
//      <object>, <embed>, <link> and their matching closers, tolerating
//      whitespace inside the closing tag (per HTML spec) and nested-tag
//      bypass payloads like `<scr<script>ipt>`.
//   2. stripEventHandlers   — removes `on*` attributes from every tag,
//      whatever whitespace/quoting they use.
//   3. stripUnsafeUriValues — neutralizes javascript: / data:text/html
//      URI values inside href / xlink:href / src / action / formaction
//      attributes, replacing the value with an empty string.
//
// The full sanitizer iterates the three passes until the input is stable
// (cap at 8 iterations to bound pathological deeply-nested payloads).
// Tests live in scripts/tests/pipeline.test.js.

const DISALLOWED_TAGS = new Set([
  'script', 'iframe', 'foreignobject', 'object', 'embed', 'link',
]);

const URI_ATTRS = new Set(['href', 'xlink:href', 'src', 'action', 'formaction']);

/**
 * Find the next `<` that opens a tag whose lowercased name is in `names`.
 * Returns `{ start, nameEnd, name }` or `null`.
 */
function findTagOpening(s, names, from = 0) {
  let i = from;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt === -1) return null;
    // Skip "</tag" closers in this walk — handled by findTagClose.
    if (s[lt + 1] === '/') { i = lt + 1; continue; }
    let j = lt + 1;
    while (j < s.length && /[a-zA-Z0-9]/.test(s[j])) j++;
    const name = s.slice(lt + 1, j).toLowerCase();
    if (name && names.has(name)) return { start: lt, nameEnd: j, name };
    i = lt + 1;
  }
}

/**
 * Find a closing tag `</NAME...>` starting at or after `from`. Tolerates
 * arbitrary whitespace and attribute-like cruft between the name and `>`,
 * which HTML5 permits in closing tags.
 */
function findTagClose(s, name, from) {
  let i = from;
  const lowerName = name.toLowerCase();
  while (i < s.length) {
    const lt = s.indexOf('</', i);
    if (lt === -1) return null;
    let j = lt + 2;
    while (j < s.length && /[a-zA-Z0-9]/.test(s[j])) j++;
    const found = s.slice(lt + 2, j).toLowerCase();
    if (found === lowerName) {
      const gt = s.indexOf('>', j);
      if (gt === -1) return null;
      return { start: lt, end: gt + 1 };
    }
    i = lt + 1;
  }
}

/**
 * Find the `>` that ends a tag opened at `from`. Returns the index
 * just past the `>` (or s.length if unterminated).
 */
function findTagEnd(s, from) {
  let i = from;
  let quote = null;
  while (i < s.length) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i + 1;
    }
    i++;
  }
  return s.length;
}

function stripDisallowedTags(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const hit = findTagOpening(s, DISALLOWED_TAGS, i);
    if (!hit) { out += s.slice(i); break; }
    out += s.slice(i, hit.start);
    const openEnd = findTagEnd(s, hit.nameEnd);
    // Self-closing? Look for `/>` at the open-tag's end.
    const selfClose = openEnd >= 2 && s[openEnd - 2] === '/';
    if (selfClose) { i = openEnd; continue; }
    // Find matching closer; if none, drop to EOF (defensive — an
    // unbalanced <script> with no closer is itself an attack signal).
    const closer = findTagClose(s, hit.name, openEnd);
    if (!closer) { i = s.length; continue; }
    i = closer.end;
  }
  // Sweep orphan closers (`</script ...>` with no opener left over).
  return stripOrphanClosers(out);
}

function stripOrphanClosers(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('</', i);
    if (lt === -1) { out += s.slice(i); break; }
    let j = lt + 2;
    while (j < s.length && /[a-zA-Z0-9]/.test(s[j])) j++;
    const name = s.slice(lt + 2, j).toLowerCase();
    if (DISALLOWED_TAGS.has(name)) {
      out += s.slice(i, lt);
      const gt = s.indexOf('>', j);
      if (gt === -1) { i = s.length; break; }
      i = gt + 1;
    } else {
      out += s.slice(i, lt + 1);
      i = lt + 1;
    }
  }
  return out;
}

/**
 * Strip every attribute whose name starts with `on` (case-insensitive)
 * from each tag's attribute list.
 */
function stripEventHandlers(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt === -1) { out += s.slice(i); break; }
    out += s.slice(i, lt);
    // Find tag name end
    const tagStart = lt + (s[lt + 1] === '/' ? 2 : 1);
    let j = tagStart;
    while (j < s.length && /[a-zA-Z0-9:-]/.test(s[j])) j++;
    out += s.slice(lt, j);
    // Walk attributes inside the tag
    while (j < s.length && s[j] !== '>') {
      if (/\s/.test(s[j])) { out += s[j]; j++; continue; }
      // Read attribute name
      const nameStart = j;
      while (j < s.length && /[a-zA-Z0-9:_-]/.test(s[j])) j++;
      // Guarantee forward progress on chars that aren't whitespace,
      // attr-name, or `>` (stray `!`, `=` with no preceding name, etc.).
      // Without this guard, the outer while loop would spin forever.
      if (j === nameStart) { out += s[j]; j++; continue; }
      const attrName = s.slice(nameStart, j).toLowerCase();
      // Optional whitespace + '=' + quoted/unquoted value
      let valEnd = j;
      let k = j;
      while (k < s.length && /\s/.test(s[k])) k++;
      if (s[k] === '=') {
        k++;
        while (k < s.length && /\s/.test(s[k])) k++;
        if (s[k] === '"' || s[k] === "'") {
          const q = s[k]; k++;
          while (k < s.length && s[k] !== q) k++;
          if (k < s.length) k++; // consume closer
        } else {
          while (k < s.length && !/[\s>]/.test(s[k])) k++;
        }
        valEnd = k;
      }
      // Drop if this is an event handler attribute. We treat any 2+ char
      // attribute starting with "on" as an event handler, matching the
      // browser's own dispatch table (onclick, onmouseover, etc.).
      if (attrName.length >= 2 && attrName.charAt(0) === 'o' && attrName.charAt(1) === 'n') {
        // Trim a single leading whitespace we already appended for spacing,
        // since the attribute is being removed entirely.
        if (out.length > 0 && /\s/.test(out[out.length - 1])) out = out.slice(0, -1);
        j = valEnd;
      } else {
        out += s.slice(nameStart, valEnd);
        j = valEnd;
      }
    }
    if (j < s.length) { out += s[j]; j++; }
    i = j;
  }
  return out;
}

/**
 * Replace javascript: and data:text/html URI values inside any URI-bearing
 * attribute with an empty string. Operates per-tag so we don't false-match
 * values in arbitrary text content.
 */
function stripUnsafeUriValues(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt === -1) { out += s.slice(i); break; }
    out += s.slice(i, lt);
    const tagStart = lt + (s[lt + 1] === '/' ? 2 : 1);
    let j = tagStart;
    while (j < s.length && /[a-zA-Z0-9:-]/.test(s[j])) j++;
    out += s.slice(lt, j);
    while (j < s.length && s[j] !== '>') {
      if (/\s/.test(s[j])) { out += s[j]; j++; continue; }
      const nameStart = j;
      while (j < s.length && /[a-zA-Z0-9:_-]/.test(s[j])) j++;
      // Forward-progress guard — same rationale as in stripEventHandlers.
      if (j === nameStart) { out += s[j]; j++; continue; }
      const attrName = s.slice(nameStart, j).toLowerCase();
      let k = j;
      while (k < s.length && /\s/.test(s[k])) k++;
      if (s[k] === '=') {
        k++;
        while (k < s.length && /\s/.test(s[k])) k++;
        if (s[k] === '"' || s[k] === "'") {
          const q = s[k];
          const valStart = k + 1;
          let v = valStart;
          while (v < s.length && s[v] !== q) v++;
          const value = s.slice(valStart, v).trim().toLowerCase();
          const isUnsafe = URI_ATTRS.has(attrName) && (
            value.startsWith('javascript:') || value.startsWith('data:text/html')
          );
          if (isUnsafe) {
            // Normalize the cleared value to double-quoted "" — it's
            // the canonical empty-attribute form and makes downstream
            // diffing/assertions consistent regardless of whether the
            // attacker payload used single or double quotes.
            out += s.slice(nameStart, j) + '=""';
          } else {
            out += s.slice(nameStart, v + 1);
          }
          k = v + 1;
        } else {
          const valStart = k;
          while (k < s.length && !/[\s>]/.test(s[k])) k++;
          out += s.slice(nameStart, k);
        }
      } else {
        out += s.slice(nameStart, k);
      }
      j = k;
    }
    if (j < s.length) { out += s[j]; j++; }
    i = j;
  }
  return out;
}

/**
 * Sanitize SVG content. Iterates the three string-walking passes until
 * the output stabilizes (cap at 8 iterations to bound pathological
 * deeply-nested payloads). Exported for testing.
 */
export function sanitizeSvg(svgContent) {
  let svg = String(svgContent || '');
  let prev;
  for (let i = 0; i < 8; i++) {
    prev = svg;
    svg = stripDisallowedTags(svg);
    svg = stripEventHandlers(svg);
    svg = stripUnsafeUriValues(svg);
    if (svg === prev) break;
  }
  return svg;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Auth: AccountKey OR a scoped Bearer token with "pipeline:write"
  if (!await authorizeWithScope(request, env, 'pipeline:write', () => authenticateAccount(request, env))) {
    return errorResponse(401, 'Unauthorized', 'AccountKey header or a scoped Bearer token with "pipeline:write" is required for pipeline operations. This is a control-plane endpoint that creates infrastructure assets.');
  }

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return errorResponse(501, 'NotConfigured', 'Pipeline requires GITHUB_TOKEN and GITHUB_REPO environment variables. Configure these in your Cloudflare Pages project settings.');
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'InvalidBody', 'Request body must be valid JSON with fields: mode, name, svg. Optional: generateFavicon, generateIcons, generateBanners.');
  }

  const { mode, name, svg, generateFavicon = true, generateIcons = true, generateBanners = true } = body;

  // Validate mode
  if (!mode || (mode !== 'client' && mode !== 'stock')) {
    return errorResponse(400, 'InvalidMode', 'The "mode" field must be either "client" or "stock". Client mode scaffolds a full zone directory; stock mode uploads to the shared image library.');
  }

  // Validate name (required for client, optional for stock)
  if (mode === 'client') {
    if (!name || typeof name !== 'string') {
      return errorResponse(400, 'MissingName', 'The "name" field is required for client mode. Provide a slugified zone name (2-64 characters, lowercase alphanumeric and hyphens).');
    }
    if (!NAME_RE.test(name)) {
      return errorResponse(400, 'InvalidName', `Name "${name}" is invalid. Must be 2-64 characters, lowercase alphanumeric and hyphens only, starting and ending with an alphanumeric character.`);
    }
  }

  // Validate SVG data
  if (!svg || typeof svg !== 'string') {
    return errorResponse(400, 'MissingSvg', 'The "svg" field is required and must contain the SVG data as a base64-encoded string.');
  }

  // Decode and sanitize SVG
  let svgContent;
  try {
    svgContent = atob(svg);
  } catch {
    return errorResponse(400, 'InvalidBase64', 'The "svg" field contains invalid base64 data. Encode your SVG file content as a standard base64 string.');
  }

  if (!svgContent.includes('<svg')) {
    return errorResponse(400, 'InvalidSvg', 'The decoded content does not appear to be a valid SVG. Ensure the base64 data represents an SVG file containing an <svg> element.');
  }

  const sanitized = sanitizeSvg(svgContent);
  const sanitizedB64 = btoa(sanitized);

  // Build path prefix
  const prefix = mode === 'client' ? `clients/${name}/v1/` : 'stocks/images/';
  const assetName = mode === 'client' ? name : (body.stockName || 'asset');

  // Build file list
  const files = [];

  // 1. Source SVG
  files.push({
    path: `${prefix}logos/${assetName}.svg`,
    content: sanitizedB64,
    encoding: 'base64',
  });

  // 2. Icon variants (stored as SVG since we can't rasterize at edge without Image Resizing on upload)
  if (generateIcons !== false) {
    files.push({
      path: `${prefix}icons/180x180.png`,
      content: sanitizedB64,
      encoding: 'base64',
    });
    files.push({
      path: `${prefix}icons/192x192.png`,
      content: sanitizedB64,
      encoding: 'base64',
    });
    files.push({
      path: `${prefix}icons/512x512.png`,
      content: sanitizedB64,
      encoding: 'base64',
    });
  }

  // 3. Favicon (at project root, not inside v1/)
  if (generateFavicon !== false) {
    const faviconPath = mode === 'client' ? `clients/${name}/favicon.ico` : 'stocks/favicon.ico';
    files.push({
      path: faviconPath,
      content: sanitizedB64,
      encoding: 'base64',
    });
  }

  // 4. Client-mode directory scaffolding
  if (mode === 'client' && generateBanners !== false) {
    const gitkeep = btoa('');
    for (const dir of ['banners', 'github', 'titles']) {
      files.push({
        path: `${prefix}${dir}/.gitkeep`,
        content: gitkeep,
        encoding: 'base64',
      });
    }
  }

  // Execute: GitHub Git Database API (same pattern as batch.js)
  const repo = env.GITHUB_REPO;
  const headers = ghHeaders(env.GITHUB_TOKEN);
  const branch = 'main';

  try {
    // 1. Get current HEAD
    const refRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, { headers });
    if (!refRes.ok) throw new Error('Failed to get branch ref');
    const headSha = (await refRes.json()).object.sha;

    // 2. Get base tree
    const commitRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/commits/${headSha}`, { headers });
    if (!commitRes.ok) throw new Error('Failed to get commit');
    const baseTree = (await commitRes.json()).tree.sha;

    // 3. Create blobs
    const treeEntries = [];
    for (const file of files) {
      const blobRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/blobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: file.content, encoding: file.encoding }),
      });
      if (!blobRes.ok) throw new Error('Failed to create blob');
      const blob = await blobRes.json();
      treeEntries.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      });
    }

    // 4. Create tree
    const treeRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ base_tree: baseTree, tree: treeEntries }),
    });
    if (!treeRes.ok) throw new Error('Failed to create tree');
    const treeSha = (await treeRes.json()).sha;

    // 5. Create commit
    const commitMsg = mode === 'client'
      ? `feat: scaffold ${name} zone with ${files.length} assets via Pipeline [skip ci]`
      : `feat: ingest stock asset via Pipeline [skip ci]`;

    const newCommitRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: commitMsg, parents: [headSha], tree: treeSha }),
    });
    if (!newCommitRes.ok) throw new Error('Failed to create commit');
    const commitSha = (await newCommitRes.json()).sha;

    // 6. Update branch ref
    const updateRes = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sha: commitSha }),
    });
    if (!updateRes.ok) throw new Error('Failed to update branch');

    // 7. Async cache purge
    if (env.CLOUDFLARE_ZONE_ID && env.CLOUDFLARE_API_TOKEN) {
      const origin = cdnOrigin(request.url);
      const urls = files.map(f => {
        const publicPath = f.path.startsWith('clients/') ? f.path.slice('clients/'.length) : f.path;
        return `${origin}/${publicPath}`;
      });
      context.waitUntil(
        fetch(`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: urls }),
        }).catch(() => {})
      );
    }

    return new Response(JSON.stringify({
      HttpCode: 201,
      Message: `Pipeline completed: ${files.length} files created for ${mode} mode${mode === 'client' ? ` (zone: ${name})` : ''}.`,
      Commit: commitSha,
      Mode: mode,
      Name: mode === 'client' ? name : assetName,
      Files: files.map(f => f.path),
      EdgeStatus: 'pending',
      EdgeNote: 'Files committed. Available at the edge after CI/CD deploy (~60-90 seconds).',
      DateCreated: new Date().toISOString(),
    }, null, 2), { status: 201, headers: CORS_HEADERS });

  } catch (err) {
    log.error('PIPELINE_ERROR', err.message);
    return errorResponse(500, 'PipelineError', 'Pipeline failed due to an unexpected error. Verify your credentials and try again.');
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
  });
}
