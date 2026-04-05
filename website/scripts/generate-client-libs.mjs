#!/usr/bin/env node

/**
 * generate-client-libs.mjs
 *
 * Reads the OpenAPI spec and generates copy-paste-ready client library
 * code snippets for JavaScript, TypeScript, Python, and curl.
 *
 * Usage: node website/scripts/generate-client-libs.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, "../api-reference/openapi.json");
const OUT_DIR = resolve(__dirname, "../api-reference/clients");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadSpec() {
  return JSON.parse(readFileSync(SPEC_PATH, "utf-8"));
}

/** Gather every operation from the spec into a flat list. */
function collectOperations(spec) {
  const ops = [];
  for (const [pathTemplate, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op.operationId) continue;
      const params = op.parameters || [];
      const pathParams = params.filter((p) => p.in === "path");
      const queryParams = params.filter((p) => p.in === "query");
      const headerParams = params.filter(
        (p) => p.in === "header" && p.name !== "AccessKey" && p.name !== "AccountKey" && p.name !== "x-api-key",
      );
      const hasBody = !!op.requestBody;
      const bodyContentType = hasBody
        ? Object.keys(op.requestBody.content)[0]
        : null;
      const isBinary = bodyContentType === "application/octet-stream";

      // Determine auth header
      let authHeader = null;
      let authEnvHint = null;
      if (op.security && op.security.length > 0) {
        const first = op.security[0];
        const schemeName = Object.keys(first)[0];
        if (schemeName) {
          const scheme = spec.components.securitySchemes[schemeName];
          if (scheme) {
            authHeader = scheme.name;
            authEnvHint = schemeName;
          }
        }
      }

      ops.push({
        operationId: op.operationId,
        summary: op.summary || "",
        method: method.toUpperCase(),
        pathTemplate,
        pathParams,
        queryParams,
        headerParams,
        hasBody,
        bodyContentType,
        isBinary,
        authHeader,
        authEnvHint,
        tags: op.tags || [],
      });
    }
  }
  return ops;
}

/** Convert operationId to a safe function name. */
function fnName(id) {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

/** Convert operationId to PascalCase for TS types. */
function typeName(id) {
  return id
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .split(/[^a-zA-Z0-9]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

/** Build a path expression with template-literal style for JS/TS. */
function jsPath(tpl, params) {
  let s = tpl;
  for (const p of params) {
    s = s.replace(`{${p.name}}`, `\${${p.name}}`);
  }
  return s;
}

// ---------------------------------------------------------------------------
// JavaScript generator
// ---------------------------------------------------------------------------

function generateJavaScript(spec, ops) {
  const lines = [
    "// CloudCDN API Client — JavaScript (ES Module)",
    "// Auto-generated from openapi.json — do not edit manually",
    "//",
    `// Base URL: ${spec.servers[0].url}`,
    "",
    'const BASE_URL = "https://cloudcdn.pro";',
    "",
    "/**",
    " * Internal helper — sends a request and returns parsed JSON or raw Response.",
    " */",
    "async function _request(method, path, { headers = {}, body, query, raw = false } = {}) {",
    "  const url = new URL(path, BASE_URL);",
    "  if (query) {",
    "    for (const [k, v] of Object.entries(query)) {",
    "      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));",
    "    }",
    "  }",
    "  const res = await fetch(url, {",
    "    method,",
    '    headers: { ...headers, ...(body && typeof body === "object" && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}) },',
    '    body: body && typeof body === "object" && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array) ? JSON.stringify(body) : body,',
    "  });",
    "  if (raw) return res;",
    "  if (!res.ok) {",
    "    const err = await res.json().catch(() => ({ error: res.statusText }));",
    '    throw Object.assign(new Error(err.Message || err.error || "Request failed"), { status: res.status, body: err });',
    "  }",
    "  const ct = res.headers.get('content-type') || '';",
    "  if (ct.includes('application/json')) return res.json();",
    "  return res;",
    "}",
    "",
  ];

  for (const op of ops) {
    const params = [];
    for (const p of op.pathParams) params.push(p.name);
    if (op.hasBody) params.push("body");
    const hasQuery = op.queryParams.length > 0;
    if (hasQuery) params.push("query = {}");
    const hasAuth = !!op.authHeader;
    if (hasAuth) params.push(`apiKey`);

    lines.push(`/** ${op.summary} [${op.method} ${op.pathTemplate}] */`);
    lines.push(`export async function ${fnName(op.operationId)}(${params.join(", ")}) {`);

    const headers = [];
    if (hasAuth) {
      headers.push(`"${op.authHeader}": apiKey`);
    }
    if (op.isBinary) {
      headers.push('"Content-Type": "application/octet-stream"');
    }

    const headersObj = headers.length > 0 ? `{ ${headers.join(", ")} }` : "{}";
    const raw = op.method === "HEAD" || (op.operationId === "transformImage") || (op.operationId === "autoFormat") || (op.operationId === "streamVideo") || (op.operationId === "verifySignedUrl");

    lines.push(
      `  return _request("${op.method}", \`${jsPath(op.pathTemplate, op.pathParams)}\`, { headers: ${headersObj}${op.hasBody ? ", body" : ""}${hasQuery ? ", query" : ""}${raw ? ", raw: true" : ""} });`,
    );
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// TypeScript generator
// ---------------------------------------------------------------------------

function generateTypeScript(spec, ops) {
  const lines = [
    "// CloudCDN API Client — TypeScript",
    "// Auto-generated from openapi.json — do not edit manually",
    "//",
    `// Base URL: ${spec.servers[0].url}`,
    "",
    'const BASE_URL = "https://cloudcdn.pro";',
    "",
    "// ---------------------------------------------------------------------------",
    "// Types",
    "// ---------------------------------------------------------------------------",
    "",
  ];

  // Generate interfaces for query param objects
  for (const op of ops) {
    if (op.queryParams.length > 0) {
      lines.push(`export interface ${typeName(op.operationId)}Query {`);
      for (const p of op.queryParams) {
        const tsType = p.schema?.type === "integer" ? "number" : "string";
        const opt = p.required ? "" : "?";
        lines.push(`  ${p.name}${opt}: ${tsType};`);
      }
      lines.push("}");
      lines.push("");
    }
  }

  // Options interface
  lines.push("export interface RequestOptions {");
  lines.push("  headers?: Record<string, string>;");
  lines.push("  body?: unknown;");
  lines.push("  query?: Record<string, string | number | boolean | undefined>;");
  lines.push("  raw?: boolean;");
  lines.push("}");
  lines.push("");

  // Helper
  lines.push("async function _request(method: string, path: string, opts: RequestOptions = {}): Promise<unknown> {");
  lines.push("  const url = new URL(path, BASE_URL);");
  lines.push("  if (opts.query) {");
  lines.push("    for (const [k, v] of Object.entries(opts.query)) {");
  lines.push("      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));");
  lines.push("    }");
  lines.push("  }");
  lines.push("  const isJson = opts.body && typeof opts.body === 'object' && !(opts.body instanceof Blob) && !(opts.body instanceof ArrayBuffer) && !(opts.body instanceof Uint8Array);");
  lines.push("  const res = await fetch(url.toString(), {");
  lines.push("    method,");
  lines.push('    headers: { ...opts.headers, ...(isJson ? { "Content-Type": "application/json" } : {}) },');
  lines.push("    body: isJson ? JSON.stringify(opts.body) : (opts.body as BodyInit | undefined),");
  lines.push("  });");
  lines.push("  if (opts.raw) return res;");
  lines.push("  if (!res.ok) {");
  lines.push("    const err: Record<string, unknown> = await res.json().catch(() => ({ error: res.statusText }));");
  lines.push('    throw Object.assign(new Error((err.Message || err.error || "Request failed") as string), { status: res.status, body: err });');
  lines.push("  }");
  lines.push("  const ct = res.headers.get('content-type') || '';");
  lines.push("  if (ct.includes('application/json')) return res.json();");
  lines.push("  return res;");
  lines.push("}");
  lines.push("");

  for (const op of ops) {
    const params = [];
    for (const p of op.pathParams) params.push(`${p.name}: string`);
    if (op.hasBody) {
      params.push(op.isBinary ? "body: Blob | ArrayBuffer | Uint8Array" : "body: Record<string, unknown>");
    }
    const hasQuery = op.queryParams.length > 0;
    if (hasQuery) params.push(`query?: Partial<${typeName(op.operationId)}Query>`);
    const hasAuth = !!op.authHeader;
    if (hasAuth) params.push("apiKey: string");

    const raw = op.method === "HEAD" || ["transformImage", "autoFormat", "streamVideo", "verifySignedUrl"].includes(op.operationId);
    const returnType = raw ? "Promise<Response>" : "Promise<unknown>";

    lines.push(`/** ${op.summary} [${op.method} ${op.pathTemplate}] */`);
    lines.push(`export async function ${fnName(op.operationId)}(${params.join(", ")}): ${returnType} {`);

    const headers = [];
    if (hasAuth) headers.push(`"${op.authHeader}": apiKey`);
    if (op.isBinary) headers.push('"Content-Type": "application/octet-stream"');

    const headersObj = headers.length > 0 ? `{ ${headers.join(", ")} }` : "{}";
    lines.push(
      `  return _request("${op.method}", \`${jsPath(op.pathTemplate, op.pathParams)}\`, { headers: ${headersObj}${op.hasBody ? ", body" : ""}${hasQuery ? ", query: query as Record<string, string | number | boolean | undefined>" : ""}${raw ? ", raw: true" : ""} }) as ${returnType};`,
    );
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Python generator
// ---------------------------------------------------------------------------

function generatePython(spec, ops) {
  const lines = [
    '"""',
    "CloudCDN API Client -- Python (requests)",
    "Auto-generated from openapi.json -- do not edit manually",
    "",
    `Base URL: ${spec.servers[0].url}`,
    '"""',
    "",
    "import requests",
    "from typing import Any, Optional",
    "",
    'BASE_URL = "https://cloudcdn.pro"',
    "",
    "",
    "def _request(",
    "    method: str,",
    "    path: str,",
    "    *,",
    "    headers: Optional[dict] = None,",
    "    json_body: Any = None,",
    "    data: Any = None,",
    "    params: Optional[dict] = None,",
    "    stream: bool = False,",
    ") -> requests.Response:",
    '    """Send an HTTP request and return the Response."""',
    "    url = f\"{BASE_URL}{path}\"",
    "    resp = requests.request(",
    "        method,",
    "        url,",
    "        headers=headers or {},",
    "        json=json_body,",
    "        data=data,",
    "        params=params,",
    "        stream=stream,",
    "    )",
    "    resp.raise_for_status()",
    "    return resp",
    "",
    "",
  ];

  for (const op of ops) {
    const pyParams = [];
    for (const p of op.pathParams) pyParams.push(`${p.name}: str`);
    if (op.hasBody && !op.isBinary) pyParams.push("body: dict");
    if (op.hasBody && op.isBinary) pyParams.push("data: bytes");
    if (op.queryParams.length > 0) pyParams.push("params: Optional[dict] = None");
    if (op.authHeader) pyParams.push("api_key: str = \"\"");

    const sig = pyParams.length > 0 ? pyParams.join(", ") : "";

    lines.push(`def ${fnName(op.operationId)}(${sig}) -> requests.Response:`);
    lines.push(`    """${op.summary} [${op.method} ${op.pathTemplate}]"""`);

    // Build path
    let pyPath = op.pathTemplate;
    for (const p of op.pathParams) {
      pyPath = pyPath.replace(`{${p.name}}`, `{${p.name}}`);
    }
    if (op.pathParams.length > 0) {
      lines.push(`    path = f"${pyPath}"`);
    } else {
      lines.push(`    path = "${pyPath}"`);
    }

    // Headers
    if (op.authHeader) {
      lines.push(`    headers = {"${op.authHeader}": api_key}`);
    } else {
      lines.push("    headers = {}");
    }
    if (op.isBinary) {
      lines.push('    headers["Content-Type"] = "application/octet-stream"');
    }

    const isStream = op.operationId === "chatConcierge";
    const reqArgs = ["method, path, headers=headers"];
    if (op.hasBody && !op.isBinary) reqArgs.push("json_body=body");
    if (op.hasBody && op.isBinary) reqArgs.push("data=data");
    if (op.queryParams.length > 0) reqArgs.push("params=params");
    if (isStream) reqArgs.push("stream=True");

    lines.push(`    method = "${op.method}"`);
    lines.push(`    return _request(${reqArgs.join(", ")})`);
    lines.push("");
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// cURL generator
// ---------------------------------------------------------------------------

function generateCurl(spec, ops) {
  const lines = [
    "#!/usr/bin/env bash",
    "# CloudCDN API Client -- cURL commands",
    "# Auto-generated from openapi.json -- do not edit manually",
    "#",
    `# Base URL: ${spec.servers[0].url}`,
    "#",
    "# Usage: source this file, then call any function.",
    '# All functions print the curl command to stdout and execute it.',
    "#",
    "# Configure these environment variables:",
    '#   CLOUDCDN_BASE_URL  (default: "https://cloudcdn.pro")',
    '#   CLOUDCDN_ACCESS_KEY',
    '#   CLOUDCDN_ACCOUNT_KEY',
    '#   CLOUDCDN_PURGE_KEY',
    '#   CLOUDCDN_ANALYTICS_KEY',
    "",
    'CLOUDCDN_BASE_URL="${CLOUDCDN_BASE_URL:-https://cloudcdn.pro}"',
    "",
  ];

  for (const op of ops) {
    // Build function
    const shellFn = fnName(op.operationId);
    lines.push(`# ${op.summary} [${op.method} ${op.pathTemplate}]`);
    lines.push(`${shellFn}() {`);

    // Determine auth env var
    let authVar = "";
    if (op.authHeader === "AccessKey") authVar = "CLOUDCDN_ACCESS_KEY";
    else if (op.authHeader === "AccountKey") authVar = "CLOUDCDN_ACCOUNT_KEY";
    else if (op.authHeader === "x-api-key" && op.authEnvHint === "PurgeKey") authVar = "CLOUDCDN_PURGE_KEY";
    else if (op.authHeader === "x-api-key" && op.authEnvHint === "AnalyticsKey") authVar = "CLOUDCDN_ANALYTICS_KEY";

    const curlParts = ["  curl -s"];

    if (op.method !== "GET") {
      curlParts.push(`-X ${op.method}`);
    }

    if (authVar) {
      curlParts.push(`-H '${op.authHeader}: '\\"\\$${authVar}\\"`);
    }

    // Simplified: use positional args for path params
    let urlPath = op.pathTemplate;
    const argNames = [];
    for (let i = 0; i < op.pathParams.length; i++) {
      const p = op.pathParams[i];
      urlPath = urlPath.replace(`{${p.name}}`, `$${i + 1}`);
      argNames.push(p.name);
    }

    if (op.hasBody && op.isBinary) {
      const bodyArgIdx = op.pathParams.length + 1;
      curlParts.push("-H 'Content-Type: application/octet-stream'");
      curlParts.push(`--data-binary @"$${bodyArgIdx}"`);
      argNames.push("file_path");
    } else if (op.hasBody) {
      const bodyArgIdx = op.pathParams.length + 1;
      curlParts.push("-H 'Content-Type: application/json'");
      curlParts.push(`-d "$${bodyArgIdx}"`);
      argNames.push("json_body");
    }

    curlParts.push(`"\\$CLOUDCDN_BASE_URL${urlPath}"`);

    if (argNames.length > 0) {
      lines.push(`  # Args: ${argNames.join(", ")}`);
    }

    // Write as a single readable curl command
    lines.push("  curl -s \\");
    if (op.method !== "GET" && op.method !== "HEAD") {
      lines.push(`    -X ${op.method} \\`);
    }
    if (op.method === "HEAD") {
      lines.push("    -I \\");
    }
    if (authVar) {
      lines.push(`    -H "${op.authHeader}: $${authVar}" \\`);
    }
    if (op.hasBody && op.isBinary) {
      const idx = op.pathParams.length + 1;
      lines.push("    -H 'Content-Type: application/octet-stream' \\");
      lines.push(`    --data-binary @"$${idx}" \\`);
    } else if (op.hasBody) {
      const idx = op.pathParams.length + 1;
      lines.push("    -H 'Content-Type: application/json' \\");
      lines.push(`    -d "$${idx}" \\`);
    }

    // Build URL with path params replaced by positional args
    let shellUrl = op.pathTemplate;
    for (let i = 0; i < op.pathParams.length; i++) {
      shellUrl = shellUrl.replace(`{${op.pathParams[i].name}}`, `$${i + 1}`);
    }
    lines.push(`    "$CLOUDCDN_BASE_URL${shellUrl}"`);
    lines.push("}");
    lines.push("");
  }

  // Add a usage section at the bottom
  lines.push("# ---------------------------------------------------------------------------");
  lines.push("# Example usage:");
  lines.push("# ---------------------------------------------------------------------------");
  lines.push("#");
  lines.push('#   export CLOUDCDN_ACCESS_KEY="your-key"');
  lines.push("#   source website/api-reference/clients/curl.sh");
  lines.push('#   listAssets  # lists assets');
  lines.push('#   storageUpload "clients/akande/v1/logos/new.svg" ./new.svg');
  lines.push('#   createZone \'{"Name":"newclient"}\'');
  lines.push("#");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function main(specPathOverride, outDirOverride) {
  const specFile = specPathOverride || SPEC_PATH;
  const outDir = outDirOverride || OUT_DIR;
  const spec = JSON.parse(readFileSync(specFile, "utf-8"));
  const ops = collectOperations(spec);

  mkdirSync(outDir, { recursive: true });

  const jsCode = generateJavaScript(spec, ops);
  writeFileSync(resolve(outDir, "javascript.js"), jsCode);
  console.log(`  wrote javascript.js (${ops.length} functions)`);

  const tsCode = generateTypeScript(spec, ops);
  writeFileSync(resolve(outDir, "typescript.ts"), tsCode);
  console.log(`  wrote typescript.ts (${ops.length} functions)`);

  const pyCode = generatePython(spec, ops);
  writeFileSync(resolve(outDir, "python.py"), pyCode);
  console.log(`  wrote python.py (${ops.length} functions)`);

  const shCode = generateCurl(spec, ops);
  writeFileSync(resolve(outDir, "curl.sh"), shCode);
  console.log(`  wrote curl.sh (${ops.length} commands)`);

  console.log(`\nGenerated ${ops.length} endpoint wrappers in 4 languages.`);
  return { ops: ops.length, files: 4 };
}

// Run when invoked directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith("generate-client-libs.mjs") ||
  process.argv[1] === fileURLToPath(import.meta.url)
);
if (isMain) {
  main();
}
