#!/usr/bin/env node

/**
 * generate-client-libs.mjs
 *
 * Reads the OpenAPI 3.1 spec and writes production-quality client
 * libraries for JavaScript (ESM), TypeScript, Python, and curl.
 *
 * Output design:
 *   - Each language exposes a `CloudCDNClient` class (or shell function
 *     prefix in curl) as the primary interface — auth keys go in once at
 *     construction time, not per call.
 *   - A custom `CloudCDNError` carries the HTTP status, the parsed body,
 *     and the URL so callers can branch on rate limits, quota errors, etc.
 *   - JS/TS support `AbortSignal` and per-call timeout via
 *     `AbortController`. Python supports `with` for connection pooling.
 *   - Flat `export async function` wrappers (JS/TS) and module-level
 *     functions (Python) are also emitted for users who want a quick
 *     one-shot without instantiating a client — they delegate to a
 *     module-scoped default client configured from env vars.
 *
 * Usage:
 *   node scripts/generate-client-libs.mjs
 *
 * @module scripts/generate-client-libs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, "../cdn/en/api-reference/openapi.json");
const OUT_DIR = resolve(__dirname, "../cdn/en/api-reference/clients");

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/** Maps an OpenAPI security scheme name to a constructor option key. */
const AUTH_OPTION = {
  AccessKey: "accessKey",
  AccountKey: "accountKey",
  PurgeKey: "purgeKey",
  AnalyticsKey: "analyticsKey",
  BearerToken: "bearerToken",
};

/** Gather every operation from the spec into a flat, generator-friendly list. */
function collectOperations(spec) {
  const ops = [];
  for (const [pathTemplate, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op.operationId) continue;
      const params = op.parameters || [];
      const pathParams = params.filter((p) => p.in === "path");
      const queryParams = params.filter((p) => p.in === "query");
      const headerParams = params.filter(
        (p) =>
          p.in === "header" &&
          p.name !== "AccessKey" &&
          p.name !== "AccountKey" &&
          p.name !== "x-api-key",
      );

      const hasBody = !!op.requestBody;
      const bodyContentType = hasBody
        ? Object.keys(op.requestBody.content)[0]
        : null;
      const isBinary = bodyContentType === "application/octet-stream";

      // Resolve the first security scheme — we pick one auth header per op.
      // Multi-auth ops still work because the client passes whichever key
      // was configured at construction time.
      let authHeader = null;
      let authScheme = null;
      if (op.security && op.security.length > 0) {
        authScheme = Object.keys(op.security[0])[0];
        const scheme = spec.components?.securitySchemes?.[authScheme];
        if (scheme) authHeader = scheme.name || (scheme.scheme === "bearer" ? "Authorization" : null);
      }

      const tag = (op.tags && op.tags[0]) || "general";

      ops.push({
        operationId: op.operationId,
        summary: op.summary || "",
        description: op.description || "",
        method: method.toUpperCase(),
        pathTemplate,
        pathParams,
        queryParams,
        headerParams,
        hasBody,
        bodyContentType,
        isBinary,
        authHeader,
        authScheme,
        authOption: authScheme ? AUTH_OPTION[authScheme] || null : null,
        tag,
      });
    }
  }
  // Sort for stable output: alphabetical by tag, then operationId.
  ops.sort((a, b) => (a.tag.localeCompare(b.tag)) || a.operationId.localeCompare(b.operationId));
  return ops;
}

/** Render a JS/TS template-literal path: `/api/zones/${id}` */
function jsPath(tpl, params) {
  let s = tpl;
  for (const p of params) s = s.replace(`{${p.name}}`, `\${${p.name}}`);
  return s;
}

/** Render a Python f-string path: `/api/zones/{id}` (Python uses braces natively). */
function pyPath(tpl) {
  return tpl;
}

/** Sanitize identifier for any language we emit (camelCase preserved). */
function fnName(id) {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

/** PascalCase identifier for TS type names. */
function typeName(id) {
  return id
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .split(/[^a-zA-Z0-9]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

/** Resolve OpenAPI scalar `type` to a TypeScript scalar. */
function tsScalar(schema) {
  if (!schema) return "unknown";
  if (schema.enum) {
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  }
  switch (schema.type) {
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return `${tsScalar(schema.items)}[]`;
    case "string":
    default:
      return "string";
  }
}

/** Resolve to a Python type-hint scalar. Optional[X] is added by callers. */
function pyScalar(schema) {
  if (!schema) return "Any";
  switch (schema.type) {
    case "integer":
      return "int";
    case "number":
      return "float";
    case "boolean":
      return "bool";
    case "array":
      return `list[${pyScalar(schema.items)}]`;
    case "object":
      return "dict";
    case "string":
    default:
      return "str";
  }
}

// ---------------------------------------------------------------------------
// JavaScript generator
// ---------------------------------------------------------------------------

function generateJavaScript(spec, ops) {
  const baseUrl = spec.servers[0].url;
  const out = [];
  const w = (s = "") => out.push(s);

  // Header
  w("// CloudCDN API Client — JavaScript (ES Module)");
  w("// Auto-generated from openapi.json — do not edit manually.");
  w("//");
  w(`// Base URL: ${baseUrl}`);
  w("//");
  w("// Usage:");
  w("//   import { CloudCDNClient } from './javascript.js';");
  w("//   const client = new CloudCDNClient({ accessKey: process.env.CLOUDCDN_ACCESS_KEY });");
  w("//   const assets = await client.listAssets({ query: { project: 'akande' } });");
  w("//");
  w("// Each method returns parsed JSON for `application/json` responses,");
  w("// or the raw `Response` otherwise (binary endpoints like /api/transform).");
  w("// Errors throw `CloudCDNError` carrying `.status`, `.body`, and `.url`.");
  w("");
  w(`export const DEFAULT_BASE_URL = ${JSON.stringify(baseUrl)};`);
  w("// Kept as a top-level export for backward compatibility with");
  w("// existing snippets that imported `BASE_URL`.");
  w("export const BASE_URL = DEFAULT_BASE_URL;");
  w("");
  w("/**");
  w(" * Error thrown for any non-2xx response. Inspect `.status` to branch on");
  w(" * rate limits (429), auth failures (401/403), quota errors (503), etc.");
  w(" */");
  w("export class CloudCDNError extends Error {");
  w("  /**");
  w("   * @param {string} message");
  w("   * @param {{ status: number, body: unknown, url: string }} meta");
  w("   */");
  w("  constructor(message, { status, body, url }) {");
  w("    super(message);");
  w("    this.name = 'CloudCDNError';");
  w("    this.status = status;");
  w("    this.body = body;");
  w("    this.url = url;");
  w("  }");
  w("}");
  w("");
  w("/** True for plain-object bodies that should be JSON-serialised. */");
  w("function _isJsonBody(body) {");
  w("  return body && typeof body === 'object'");
  w("    && !(body instanceof Blob)");
  w("    && !(body instanceof ArrayBuffer)");
  w("    && !(body instanceof Uint8Array)");
  w("    && !(body instanceof FormData)");
  w("    && !(body instanceof URLSearchParams);");
  w("}");
  w("");
  w("/**");
  w(" * Production-quality client for the CloudCDN REST API.");
  w(" *");
  w(" * Configure auth keys once via the constructor; methods take only");
  w(" * the per-call inputs (path params, query, body). Every method accepts");
  w(" * `{ signal, timeoutMs }` overrides for cancellation and timeout.");
  w(" *");
  w(" * @example");
  w(" *   const client = new CloudCDNClient({");
  w(" *     accessKey: process.env.CLOUDCDN_ACCESS_KEY,");
  w(" *     accountKey: process.env.CLOUDCDN_ACCOUNT_KEY,");
  w(" *     timeoutMs: 15_000,");
  w(" *   });");
  w(" *   try {");
  w(" *     const summary = await client.getInsightsSummary({ query: { days: 30 } });");
  w(" *     console.log(summary.totalRequests);");
  w(" *   } catch (err) {");
  w(" *     if (err instanceof CloudCDNError && err.status === 429) {");
  w(" *       // back off and retry");
  w(" *     } else {");
  w(" *       throw err;");
  w(" *     }");
  w(" *   }");
  w(" */");
  w("export class CloudCDNClient {");
  w("  /**");
  w("   * @param {object} [opts]");
  w("   * @param {string} [opts.baseUrl]      - Defaults to `DEFAULT_BASE_URL`.");
  w("   * @param {string} [opts.accessKey]    - Storage/Assets/Insights `AccessKey` header.");
  w("   * @param {string} [opts.accountKey]   - Core / control-plane `AccountKey` header.");
  w("   * @param {string} [opts.purgeKey]     - Cache purge `x-api-key` header.");
  w("   * @param {string} [opts.analyticsKey] - Analytics `x-api-key` header.");
  w("   * @param {string} [opts.bearerToken]  - Scoped token (`cdnsk_…`) used as `Authorization: Bearer …`.");
  w("   * @param {number} [opts.timeoutMs]    - Default per-call timeout. `0` or undefined disables it.");
  w("   * @param {typeof fetch} [opts.fetch]  - Override the fetch implementation (tests / proxies).");
  w("   */");
  w("  constructor(opts = {}) {");
  w("    this.baseUrl      = opts.baseUrl      || DEFAULT_BASE_URL;");
  w("    this.accessKey    = opts.accessKey    || '';");
  w("    this.accountKey   = opts.accountKey   || '';");
  w("    this.purgeKey     = opts.purgeKey     || '';");
  w("    this.analyticsKey = opts.analyticsKey || '';");
  w("    this.bearerToken  = opts.bearerToken  || '';");
  w("    this.timeoutMs    = opts.timeoutMs    || 0;");
  w("    this._fetch       = opts.fetch        || globalThis.fetch.bind(globalThis);");
  w("  }");
  w("");
  w("  /** Build the auth header dict for the given security scheme name. */");
  w("  _authHeaders(scheme) {");
  w("    if (scheme === 'AccessKey'    && this.accessKey)    return { AccessKey: this.accessKey };");
  w("    if (scheme === 'AccountKey'   && this.accountKey)   return { AccountKey: this.accountKey };");
  w("    if (scheme === 'PurgeKey'     && this.purgeKey)     return { 'x-api-key': this.purgeKey };");
  w("    if (scheme === 'AnalyticsKey' && this.analyticsKey) return { 'x-api-key': this.analyticsKey };");
  w("    if (scheme === 'BearerToken'  && this.bearerToken)  return { Authorization: `Bearer ${this.bearerToken}` };");
  w("    return {};");
  w("  }");
  w("");
  w("  /**");
  w("   * Internal request driver. Centralises body shaping, header merging,");
  w("   * timeout, JSON parsing, and `CloudCDNError` construction.");
  w("   *");
  w("   * @param {string} method");
  w("   * @param {string} path");
  w("   * @param {object} [opts]");
  w("   * @param {string} [opts.scheme]      - OpenAPI security scheme name.");
  w("   * @param {Record<string, unknown>} [opts.headers]");
  w("   * @param {unknown} [opts.body]");
  w("   * @param {Record<string, unknown>} [opts.query]");
  w("   * @param {boolean} [opts.raw]        - Return the raw `Response` (binary).");
  w("   * @param {AbortSignal} [opts.signal] - External cancellation.");
  w("   * @param {number} [opts.timeoutMs]   - Per-call timeout override.");
  w("   * @returns {Promise<unknown>}");
  w("   */");
  w("  async _request(method, path, opts = {}) {");
  w("    const url = new URL(path, this.baseUrl);");
  w("    if (opts.query) {");
  w("      for (const [k, v] of Object.entries(opts.query)) {");
  w("        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));");
  w("      }");
  w("    }");
  w("");
  w("    const isJson = _isJsonBody(opts.body);");
  w("    const headers = {");
  w("      ...this._authHeaders(opts.scheme),");
  w("      ...(isJson ? { 'Content-Type': 'application/json' } : {}),");
  w("      ...opts.headers,");
  w("    };");
  w("");
  w("    // Timeout via AbortController; combine with any externally supplied signal.");
  w("    const t = opts.timeoutMs ?? this.timeoutMs;");
  w("    const ctrl = (t > 0) ? new AbortController() : null;");
  w("    const timer = ctrl ? setTimeout(() => ctrl.abort(new Error('Request timeout')), t) : null;");
  w("    const signal = opts.signal && ctrl");
  w("      ? AbortSignal.any([opts.signal, ctrl.signal])");
  w("      : (opts.signal || ctrl?.signal);");
  w("");
  w("    let res;");
  w("    try {");
  w("      res = await this._fetch(url.toString(), {");
  w("        method,");
  w("        headers,");
  w("        body: isJson ? JSON.stringify(opts.body) : opts.body,");
  w("        signal,");
  w("      });");
  w("    } finally {");
  w("      if (timer) clearTimeout(timer);");
  w("    }");
  w("");
  w("    if (opts.raw) return res;");
  w("    if (!res.ok) {");
  w("      const body = await res.json().catch(() => ({ error: res.statusText }));");
  w("      const message = body?.Message || body?.error || `${method} ${path} → HTTP ${res.status}`;");
  w("      throw new CloudCDNError(message, { status: res.status, body, url: url.toString() });");
  w("    }");
  w("    const ct = res.headers.get('content-type') || '';");
  w("    if (ct.includes('application/json')) return res.json();");
  w("    return res;");
  w("  }");
  w("");

  // Per-operation methods
  for (const op of ops) {
    const jsOpName = fnName(op.operationId);
    const argDocs = [];
    const argSig = [];
    const callOpts = [];

    for (const p of op.pathParams) {
      argDocs.push(`   * @param {string} ${p.name} - ${p.description || "Path parameter."}`);
      argSig.push(p.name);
    }

    // Single options bag for body/query/signal/timeout — cleaner DX than positional.
    const hasQuery = op.queryParams.length > 0;
    if (op.hasBody || hasQuery) {
      argDocs.push("   * @param {object} [opts]");
      if (op.hasBody) {
        const bodyType = op.isBinary ? "Blob|ArrayBuffer|Uint8Array" : "object";
        argDocs.push(`   * @param {${bodyType}} [opts.body] - Request body.`);
        callOpts.push("body: opts.body");
      }
      if (hasQuery) {
        argDocs.push(`   * @param {object} [opts.query] - Query parameters.`);
        callOpts.push("query: opts.query");
      }
    } else {
      argDocs.push("   * @param {object} [opts]");
    }
    argDocs.push("   * @param {AbortSignal} [opts.signal]");
    argDocs.push("   * @param {number} [opts.timeoutMs]");
    argDocs.push("   * @returns {Promise<unknown>}");
    argDocs.push("   * @throws {CloudCDNError}");

    argSig.push("opts = {}");

    const raw = op.method === "HEAD" || ["transformImage", "autoFormat", "streamVideo", "verifySignedUrl"].includes(op.operationId);
    const callArgs = [
      op.authScheme ? `scheme: '${op.authScheme}'` : null,
      ...callOpts,
      raw ? "raw: true" : null,
      "signal: opts.signal",
      "timeoutMs: opts.timeoutMs",
    ].filter(Boolean).join(", ");

    w(`  /**`);
    w(`   * ${op.summary || op.operationId} — [${op.method} ${op.pathTemplate}]`);
    if (op.description && op.description.length < 200) {
      w("   *");
      for (const line of op.description.split("\n")) w(`   * ${line.trim()}`);
    }
    if (argDocs.length) {
      w("   *");
      for (const d of argDocs) w(d);
    }
    w("   */");
    w(`  async ${jsOpName}(${argSig.join(", ")}) {`);
    w(`    return this._request('${op.method}', \`${jsPath(op.pathTemplate, op.pathParams)}\`, { ${callArgs} });`);
    w("  }");
    w("");
  }

  w("}"); // close class
  w("");

  // Module-level convenience functions (one per operation) — back-compat
  // with code that imported individual functions. Each constructs a fresh
  // client from the keys passed via the options object.
  w("// ---------------------------------------------------------------------------");
  w("// Module-level convenience wrappers");
  w("// ---------------------------------------------------------------------------");
  w("// Each function takes the same opts as the corresponding client method,");
  w("// plus the auth key(s) the operation needs. They're shorthand for");
  w("// `new CloudCDNClient({...}).operationId(...)` — fine for one-shot calls.");
  w("");
  for (const op of ops) {
    const jsOpName = fnName(op.operationId);
    const params = [...op.pathParams.map((p) => p.name), "opts = {}"];
    const clientOpts = ["baseUrl: opts.baseUrl"];
    if (op.authOption) clientOpts.push(`${op.authOption}: opts.${op.authOption}`);
    const callArgs = [...op.pathParams.map((p) => p.name), "opts"];

    w(`/** ${op.summary || op.operationId} [${op.method} ${op.pathTemplate}] */`);
    w(`export async function ${jsOpName}(${params.join(", ")}) {`);
    w(`  const c = new CloudCDNClient({ ${clientOpts.join(", ")} });`);
    w(`  return c.${jsOpName}(${callArgs.join(", ")});`);
    w(`}`);
    w("");
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// TypeScript generator
// ---------------------------------------------------------------------------

function generateTypeScript(spec, ops) {
  const baseUrl = spec.servers[0].url;
  const out = [];
  const w = (s = "") => out.push(s);

  w("// CloudCDN API Client — TypeScript");
  w("// Auto-generated from openapi.json — do not edit manually.");
  w("//");
  w(`// Base URL: ${baseUrl}`);
  w("//");
  w("// Usage:");
  w("//   import { CloudCDNClient } from './typescript';");
  w("//   const client = new CloudCDNClient({ accessKey: process.env.CLOUDCDN_ACCESS_KEY });");
  w("//   const assets = await client.listAssets({ query: { project: 'akande' } });");
  w("");
  w(`export const DEFAULT_BASE_URL = ${JSON.stringify(baseUrl)};`);
  w("export const BASE_URL = DEFAULT_BASE_URL;");
  w("");

  // ---------- Types ----------
  w("// ---------------------------------------------------------------------------");
  w("// Types");
  w("// ---------------------------------------------------------------------------");
  w("");
  w("export interface ClientOptions {");
  w("  baseUrl?: string;");
  w("  accessKey?: string;");
  w("  accountKey?: string;");
  w("  purgeKey?: string;");
  w("  analyticsKey?: string;");
  w("  bearerToken?: string;");
  w("  timeoutMs?: number;");
  w("  fetch?: typeof fetch;");
  w("}");
  w("");
  w("export interface RequestOptions {");
  w("  signal?: AbortSignal;");
  w("  timeoutMs?: number;");
  w("}");
  w("");
  w("export interface ErrorMeta {");
  w("  status: number;");
  w("  body: unknown;");
  w("  url: string;");
  w("}");
  w("");

  // Per-op query / body interfaces
  for (const op of ops) {
    if (op.queryParams.length > 0) {
      w(`export interface ${typeName(op.operationId)}Query {`);
      for (const p of op.queryParams) {
        const opt = p.required ? "" : "?";
        w(`  ${p.name}${opt}: ${tsScalar(p.schema)};`);
      }
      w("}");
      w("");
    }
  }

  // CloudCDNError
  w("export class CloudCDNError extends Error {");
  w("  readonly status: number;");
  w("  readonly body: unknown;");
  w("  readonly url: string;");
  w("  constructor(message: string, meta: ErrorMeta) {");
  w("    super(message);");
  w("    this.name = 'CloudCDNError';");
  w("    this.status = meta.status;");
  w("    this.body = meta.body;");
  w("    this.url = meta.url;");
  w("  }");
  w("}");
  w("");

  // Internal helper
  w("function isJsonBody(body: unknown): boolean {");
  w("  return Boolean(body)");
  w("    && typeof body === 'object'");
  w("    && !(body instanceof Blob)");
  w("    && !(body instanceof ArrayBuffer)");
  w("    && !(body instanceof Uint8Array)");
  w("    && !(body instanceof FormData)");
  w("    && !(body instanceof URLSearchParams);");
  w("}");
  w("");
  w("type Scheme = 'AccessKey' | 'AccountKey' | 'PurgeKey' | 'AnalyticsKey' | 'BearerToken';");
  w("");
  w("interface InternalRequestOptions extends RequestOptions {");
  w("  scheme?: Scheme;");
  w("  headers?: Record<string, string>;");
  w("  body?: unknown;");
  w("  query?: Record<string, string | number | boolean | undefined>;");
  w("  raw?: boolean;");
  w("}");
  w("");

  // ---------- Class ----------
  w("/**");
  w(" * Strongly-typed client for the CloudCDN REST API.");
  w(" *");
  w(" * @example");
  w(" *   const client = new CloudCDNClient({ accessKey: process.env.CLOUDCDN_ACCESS_KEY });");
  w(" *   const assets = await client.listAssets({ query: { project: 'akande' } });");
  w(" */");
  w("export class CloudCDNClient {");
  w("  readonly baseUrl: string;");
  w("  readonly accessKey: string;");
  w("  readonly accountKey: string;");
  w("  readonly purgeKey: string;");
  w("  readonly analyticsKey: string;");
  w("  readonly bearerToken: string;");
  w("  readonly timeoutMs: number;");
  w("  private readonly _fetch: typeof fetch;");
  w("");
  w("  constructor(opts: ClientOptions = {}) {");
  w("    this.baseUrl      = opts.baseUrl      ?? DEFAULT_BASE_URL;");
  w("    this.accessKey    = opts.accessKey    ?? '';");
  w("    this.accountKey   = opts.accountKey   ?? '';");
  w("    this.purgeKey     = opts.purgeKey     ?? '';");
  w("    this.analyticsKey = opts.analyticsKey ?? '';");
  w("    this.bearerToken  = opts.bearerToken  ?? '';");
  w("    this.timeoutMs    = opts.timeoutMs    ?? 0;");
  w("    this._fetch       = opts.fetch        ?? globalThis.fetch.bind(globalThis);");
  w("  }");
  w("");
  w("  private _authHeaders(scheme?: Scheme): Record<string, string> {");
  w("    if (scheme === 'AccessKey'    && this.accessKey)    return { AccessKey: this.accessKey };");
  w("    if (scheme === 'AccountKey'   && this.accountKey)   return { AccountKey: this.accountKey };");
  w("    if (scheme === 'PurgeKey'     && this.purgeKey)     return { 'x-api-key': this.purgeKey };");
  w("    if (scheme === 'AnalyticsKey' && this.analyticsKey) return { 'x-api-key': this.analyticsKey };");
  w("    if (scheme === 'BearerToken'  && this.bearerToken)  return { Authorization: `Bearer ${this.bearerToken}` };");
  w("    return {};");
  w("  }");
  w("");
  w("  private async _request(method: string, path: string, opts: InternalRequestOptions = {}): Promise<unknown> {");
  w("    const url = new URL(path, this.baseUrl);");
  w("    if (opts.query) {");
  w("      for (const [k, v] of Object.entries(opts.query)) {");
  w("        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));");
  w("      }");
  w("    }");
  w("");
  w("    const json = isJsonBody(opts.body);");
  w("    const headers: Record<string, string> = {");
  w("      ...this._authHeaders(opts.scheme),");
  w("      ...(json ? { 'Content-Type': 'application/json' } : {}),");
  w("      ...opts.headers,");
  w("    };");
  w("");
  w("    const t = opts.timeoutMs ?? this.timeoutMs;");
  w("    const ctrl = t > 0 ? new AbortController() : null;");
  w("    const timer = ctrl ? setTimeout(() => ctrl.abort(new Error('Request timeout')), t) : null;");
  w("    const signal = opts.signal && ctrl");
  w("      ? AbortSignal.any([opts.signal, ctrl.signal])");
  w("      : (opts.signal || ctrl?.signal);");
  w("");
  w("    let res: Response;");
  w("    try {");
  w("      res = await this._fetch(url.toString(), {");
  w("        method,");
  w("        headers,");
  w("        body: json ? JSON.stringify(opts.body) : (opts.body as BodyInit | undefined),");
  w("        signal,");
  w("      });");
  w("    } finally {");
  w("      if (timer) clearTimeout(timer);");
  w("    }");
  w("");
  w("    if (opts.raw) return res;");
  w("    if (!res.ok) {");
  w("      const body = await res.json().catch(() => ({ error: res.statusText })) as Record<string, unknown>;");
  w("      const message = (body.Message as string | undefined)");
  w("        ?? (body.error as string | undefined)");
  w("        ?? `${method} ${path} → HTTP ${res.status}`;");
  w("      throw new CloudCDNError(message, { status: res.status, body, url: url.toString() });");
  w("    }");
  w("    const ct = res.headers.get('content-type') || '';");
  w("    if (ct.includes('application/json')) return res.json();");
  w("    return res;");
  w("  }");
  w("");

  for (const op of ops) {
    const tsOpName = fnName(op.operationId);
    const params = [];
    for (const p of op.pathParams) params.push(`${p.name}: string`);

    const optsInterface = [];
    if (op.hasBody) {
      optsInterface.push(op.isBinary ? "body?: Blob | ArrayBuffer | Uint8Array" : "body?: Record<string, unknown>");
    }
    if (op.queryParams.length > 0) {
      optsInterface.push(`query?: ${typeName(op.operationId)}Query`);
    }
    optsInterface.push("signal?: AbortSignal");
    optsInterface.push("timeoutMs?: number");

    params.push(`opts: { ${optsInterface.join("; ")} } = {}`);

    const raw = op.method === "HEAD" || ["transformImage", "autoFormat", "streamVideo", "verifySignedUrl"].includes(op.operationId);
    const returnType = raw ? "Promise<Response>" : "Promise<unknown>";

    const callArgs = [
      op.authScheme ? `scheme: '${op.authScheme}'` : null,
      op.hasBody ? "body: opts.body" : null,
      op.queryParams.length ? "query: opts.query as Record<string, string | number | boolean | undefined>" : null,
      raw ? "raw: true" : null,
      "signal: opts.signal",
      "timeoutMs: opts.timeoutMs",
    ].filter(Boolean).join(", ");

    w("  /**");
    w(`   * ${op.summary || op.operationId} — [${op.method} ${op.pathTemplate}]`);
    w("   *");
    if (op.description && op.description.length < 200) {
      for (const line of op.description.split("\n")) out.push(`   * ${line.trim()}`);
      w("   *");
    }
    w("   * @throws {CloudCDNError}");
    w("   */");
    w(`  async ${tsOpName}(${params.join(", ")}): ${returnType} {`);
    w(`    return this._request('${op.method}', \`${jsPath(op.pathTemplate, op.pathParams)}\`, { ${callArgs} }) as ${returnType};`);
    w("  }");
    w("");
  }

  w("}");
  w("");

  // Flat function wrappers
  w("// ---------------------------------------------------------------------------");
  w("// Module-level convenience wrappers");
  w("// ---------------------------------------------------------------------------");
  w("");
  for (const op of ops) {
    const fname = fnName(op.operationId);
    const params = [];
    for (const p of op.pathParams) params.push(`${p.name}: string`);

    const optsInterface = ["baseUrl?: string"];
    if (op.authOption) optsInterface.push(`${op.authOption}?: string`);
    if (op.hasBody) {
      optsInterface.push(op.isBinary ? "body?: Blob | ArrayBuffer | Uint8Array" : "body?: Record<string, unknown>");
    }
    if (op.queryParams.length > 0) optsInterface.push(`query?: ${typeName(op.operationId)}Query`);
    optsInterface.push("signal?: AbortSignal");
    optsInterface.push("timeoutMs?: number");

    params.push(`opts: { ${optsInterface.join("; ")} } = {}`);

    const callArgs = [...op.pathParams.map((p) => p.name), "opts"];
    const raw = op.method === "HEAD" || ["transformImage", "autoFormat", "streamVideo", "verifySignedUrl"].includes(op.operationId);
    const returnType = raw ? "Promise<Response>" : "Promise<unknown>";

    const clientOpts = ["baseUrl: opts.baseUrl"];
    if (op.authOption) clientOpts.push(`${op.authOption}: opts.${op.authOption}`);

    w(`/** ${op.summary || op.operationId} [${op.method} ${op.pathTemplate}] */`);
    w(`export async function ${fname}(${params.join(", ")}): ${returnType} {`);
    w(`  const c = new CloudCDNClient({ ${clientOpts.join(", ")} });`);
    w(`  return c.${fname}(${callArgs.join(", ")});`);
    w(`}`);
    w("");
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Python generator
// ---------------------------------------------------------------------------

function generatePython(spec, ops) {
  const baseUrl = spec.servers[0].url;
  const out = [];
  const w = (s = "") => out.push(s);

  w('"""');
  w("CloudCDN API Client -- Python (requests).");
  w("Auto-generated from openapi.json -- do not edit manually.");
  w("");
  w(`Base URL: ${baseUrl}`);
  w("");
  w("Usage:");
  w("    from python import CloudCDNClient");
  w("");
  w("    with CloudCDNClient(access_key='sk_live_...') as client:");
  w("        summary = client.get_insights_summary(query={'days': 30})");
  w("        print(summary['totalRequests'])");
  w("");
  w("Every method returns parsed JSON (dict / list) for ``application/json``");
  w("responses, or the raw ``requests.Response`` otherwise.");
  w("Non-2xx responses raise ``CloudCDNError`` carrying ``status``, ``body``,");
  w("and ``url``.");
  w('"""');
  w("");
  w("from __future__ import annotations");
  w("");
  w("from typing import Any, Optional, Union");
  w("import requests");
  w("");
  w(`BASE_URL = "${baseUrl}"`);
  w("");
  w("");
  w("class CloudCDNError(Exception):");
  w('    """Raised for any non-2xx response from the CloudCDN API.');
  w("");
  w("    Attributes:");
  w("        status: HTTP status code returned by the edge.");
  w("        body: The parsed JSON error body, or ``{'error': <statusText>}``.");
  w("        url: The full URL that was requested (for log scraping).");
  w('    """');
  w("");
  w("    def __init__(self, message: str, *, status: int, body: Any, url: str) -> None:");
  w("        super().__init__(message)");
  w("        self.status = status");
  w("        self.body = body");
  w("        self.url = url");
  w("");
  w("");
  w("class CloudCDNClient:");
  w('    """Production-quality client for the CloudCDN REST API.');
  w("");
  w("    Pass auth keys once at construction time; per-call inputs go in");
  w("    via ``query``, ``body``, ``timeout``, etc. Supports context-manager");
  w("    use so the underlying ``requests.Session`` is closed deterministically:");
  w("");
  w("        with CloudCDNClient(access_key='sk_live_...') as client:");
  w("            data = client.list_assets(query={'project': 'akande'})");
  w('    """');
  w("");
  w("    def __init__(");
  w("        self,");
  w("        base_url: str = BASE_URL,");
  w("        *,");
  w("        access_key: Optional[str] = None,");
  w("        account_key: Optional[str] = None,");
  w("        purge_key: Optional[str] = None,");
  w("        analytics_key: Optional[str] = None,");
  w("        bearer_token: Optional[str] = None,");
  w("        timeout: Optional[float] = 30.0,");
  w("        session: Optional[requests.Session] = None,");
  w("    ) -> None:");
  w('        """Construct a client.');
  w("");
  w("        Args:");
  w("            base_url: API base URL. Defaults to production edge.");
  w("            access_key: Storage / Assets / Insights ``AccessKey`` header.");
  w("            account_key: Core / control-plane ``AccountKey`` header.");
  w("            purge_key: Cache purge ``x-api-key`` header.");
  w("            analytics_key: Analytics ``x-api-key`` header.");
  w("            bearer_token: Scoped token used as ``Authorization: Bearer …``.");
  w("            timeout: Default per-request timeout in seconds.");
  w("            session: Optional ``requests.Session`` for connection pooling.");
  w('        """');
  w("        self.base_url = base_url.rstrip('/')");
  w("        self.access_key = access_key or ''");
  w("        self.account_key = account_key or ''");
  w("        self.purge_key = purge_key or ''");
  w("        self.analytics_key = analytics_key or ''");
  w("        self.bearer_token = bearer_token or ''");
  w("        self.timeout = timeout");
  w("        self._session = session or requests.Session()");
  w("        self._owns_session = session is None");
  w("");
  w("    def __enter__(self) -> 'CloudCDNClient':");
  w("        return self");
  w("");
  w("    def __exit__(self, exc_type, exc, tb) -> None:");
  w("        self.close()");
  w("");
  w("    def close(self) -> None:");
  w('        """Close the underlying session if we created it."""');
  w("        if self._owns_session:");
  w("            self._session.close()");
  w("");
  w("    def _auth_headers(self, scheme: Optional[str]) -> dict:");
  w("        if scheme == 'AccessKey' and self.access_key:");
  w("            return {'AccessKey': self.access_key}");
  w("        if scheme == 'AccountKey' and self.account_key:");
  w("            return {'AccountKey': self.account_key}");
  w("        if scheme == 'PurgeKey' and self.purge_key:");
  w("            return {'x-api-key': self.purge_key}");
  w("        if scheme == 'AnalyticsKey' and self.analytics_key:");
  w("            return {'x-api-key': self.analytics_key}");
  w("        if scheme == 'BearerToken' and self.bearer_token:");
  w("            return {'Authorization': f'Bearer {self.bearer_token}'}");
  w("        return {}");
  w("");
  w("    def _request(");
  w("        self,");
  w("        method: str,");
  w("        path: str,");
  w("        *,");
  w("        scheme: Optional[str] = None,");
  w("        json_body: Any = None,");
  w("        data: Any = None,");
  w("        params: Optional[dict] = None,");
  w("        headers: Optional[dict] = None,");
  w("        stream: bool = False,");
  w("        raw: bool = False,");
  w("        timeout: Optional[float] = None,");
  w("    ) -> Any:");
  w('        """Send a request and return parsed JSON, or raw Response when ``raw``."""');
  w("        url = f'{self.base_url}{path}'");
  w("        merged = {**self._auth_headers(scheme), **(headers or {})}");
  w("        resp = self._session.request(");
  w("            method,");
  w("            url,");
  w("            headers=merged,");
  w("            json=json_body,");
  w("            data=data,");
  w("            params=params,");
  w("            stream=stream,");
  w("            timeout=timeout if timeout is not None else self.timeout,");
  w("        )");
  w("        if not resp.ok:");
  w("            try:");
  w("                body = resp.json()");
  w("            except Exception:  # noqa: BLE001 — body may be non-JSON");
  w("                body = {'error': resp.reason}");
  w("            msg = body.get('Message') or body.get('error') or f'{method} {path} -> HTTP {resp.status_code}'");
  w("            raise CloudCDNError(msg, status=resp.status_code, body=body, url=url)");
  w("        if raw:");
  w("            return resp");
  w("        ct = resp.headers.get('content-type', '')");
  w("        if 'application/json' in ct:");
  w("            return resp.json()");
  w("        return resp");
  w("");

  for (const op of ops) {
    const pyFnName = op.operationId.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const pyParams = ["self"];
    for (const p of op.pathParams) pyParams.push(`${p.name}: str`);

    if (op.hasBody && !op.isBinary) pyParams.push("*, body: Optional[dict] = None");
    if (op.hasBody && op.isBinary) pyParams.push("*, data: Optional[Union[bytes, bytearray]] = None");
    if (!op.hasBody && op.queryParams.length === 0) {
      pyParams.push("*, timeout: Optional[float] = None");
    } else {
      if (op.queryParams.length > 0) {
        if (op.hasBody) pyParams.push("query: Optional[dict] = None");
        else pyParams.push("*, query: Optional[dict] = None");
      }
      pyParams.push("timeout: Optional[float] = None");
    }

    const isStream = op.operationId === "chatConcierge";
    const raw = op.method === "HEAD" || ["transformImage", "autoFormat", "streamVideo", "verifySignedUrl"].includes(op.operationId);
    const returnHint = (raw || isStream) ? "requests.Response" : "Any";

    w(`    def ${pyFnName}(${pyParams.join(", ")}) -> ${returnHint}:`);
    w(`        """${op.summary || op.operationId} -- [${op.method} ${op.pathTemplate}].`);
    if (op.description) {
      w("");
      for (const line of op.description.split("\n").slice(0, 3)) w(`        ${line.trim()}`);
    }
    w("");
    if (op.pathParams.length || op.hasBody || op.queryParams.length) w("        Args:");
    for (const p of op.pathParams) w(`            ${p.name}: ${p.description || "Path parameter."}`);
    if (op.hasBody && !op.isBinary) w("            body: Request body (JSON-serialised).");
    if (op.hasBody && op.isBinary) w("            data: Raw request body bytes.");
    if (op.queryParams.length > 0) {
      w("            query: Query parameters.");
    }
    if (op.pathParams.length || op.hasBody || op.queryParams.length) w("            timeout: Per-call timeout in seconds (overrides the client default).");
    w("");
    w(`        Returns: ${returnHint === "requests.Response" ? "Raw ``requests.Response``." : "Parsed JSON or raw ``requests.Response`` for non-JSON."}`);
    w("");
    w("        Raises:");
    w("            CloudCDNError: For any non-2xx response.");
    w('        """');

    const callArgs = [`'${op.method}'`, `f'${pyPath(op.pathTemplate)}'`];
    if (op.authScheme) callArgs.push(`scheme='${op.authScheme}'`);
    if (op.hasBody && !op.isBinary) callArgs.push("json_body=body");
    if (op.hasBody && op.isBinary) callArgs.push("data=data");
    if (op.queryParams.length > 0) callArgs.push("params=query");
    if (isStream) callArgs.push("stream=True");
    if (raw) callArgs.push("raw=True");
    callArgs.push("timeout=timeout");

    w(`        return self._request(${callArgs.join(", ")})`);
    w("");
  }

  // Trim final blank line
  return out.join("\n").replace(/\n+$/, "\n");
}

// ---------------------------------------------------------------------------
// curl generator
// ---------------------------------------------------------------------------

function generateCurl(spec, ops) {
  const baseUrl = spec.servers[0].url;
  const out = [];
  const w = (s = "") => out.push(s);

  w("#!/usr/bin/env bash");
  w("# CloudCDN API Client -- cURL helpers.");
  w("# Auto-generated from openapi.json -- do not edit manually.");
  w("#");
  w(`# Base URL: ${baseUrl}`);
  w("#");
  w("# Usage:");
  w("#   source curl.sh                                # load the helpers");
  w("#   export CLOUDCDN_ACCESS_KEY=sk_live_...        # configure auth");
  w("#   listAssets 'project=akande&format=svg'        # call any function");
  w("#");
  w("# Environment variables:");
  w("#   CLOUDCDN_BASE_URL       (default: https://cloudcdn.pro)");
  w("#   CLOUDCDN_ACCESS_KEY     storage / assets / insights");
  w("#   CLOUDCDN_ACCOUNT_KEY    core / pipeline / audit / webhooks / tokens");
  w("#   CLOUDCDN_PURGE_KEY      cache purge");
  w("#   CLOUDCDN_ANALYTICS_KEY  analytics");
  w("#   CLOUDCDN_BEARER_TOKEN   scoped Bearer token (overrides per-scheme keys)");
  w("#");
  w("# Every helper passes --fail-with-body so non-2xx responses are printed");
  w("# and the helper exits non-zero -- safe to chain in scripts.");
  w("");
  w('CLOUDCDN_BASE_URL="${CLOUDCDN_BASE_URL:-' + baseUrl + '}"');
  w("");
  w("# Internal: emit the right auth flag for the OpenAPI security scheme.");
  w("__cloudcdn_auth_flag() {");
  w("  case \"$1\" in");
  w("    AccessKey)    [[ -n \"${CLOUDCDN_ACCESS_KEY:-}\" ]]    && echo \"-H AccessKey: ${CLOUDCDN_ACCESS_KEY}\" ;;");
  w("    AccountKey)   [[ -n \"${CLOUDCDN_ACCOUNT_KEY:-}\" ]]   && echo \"-H AccountKey: ${CLOUDCDN_ACCOUNT_KEY}\" ;;");
  w("    PurgeKey)     [[ -n \"${CLOUDCDN_PURGE_KEY:-}\" ]]     && echo \"-H x-api-key: ${CLOUDCDN_PURGE_KEY}\" ;;");
  w("    AnalyticsKey) [[ -n \"${CLOUDCDN_ANALYTICS_KEY:-}\" ]] && echo \"-H x-api-key: ${CLOUDCDN_ANALYTICS_KEY}\" ;;");
  w("    BearerToken)  [[ -n \"${CLOUDCDN_BEARER_TOKEN:-}\" ]]  && echo \"-H Authorization: Bearer ${CLOUDCDN_BEARER_TOKEN}\" ;;");
  w("  esac");
  w("}");
  w("");

  // Group operations by tag for readable section headers.
  const byTag = {};
  for (const op of ops) {
    (byTag[op.tag] = byTag[op.tag] || []).push(op);
  }

  for (const tag of Object.keys(byTag).sort()) {
    w("# ---------------------------------------------------------------------------");
    w(`# ${tag}`);
    w("# ---------------------------------------------------------------------------");
    w("");

    for (const op of byTag[tag]) {
      const shFn = fnName(op.operationId);
      const argNames = [];
      for (const p of op.pathParams) argNames.push(p.name);
      if (op.hasBody && op.isBinary) argNames.push("file_path");
      else if (op.hasBody) argNames.push("json_body");
      if (op.queryParams.length > 0) argNames.push("query_string");

      const sample = (op.queryParams.length > 0 ? "'project=akande&limit=5'" : "");
      const argList = argNames.join(" ");

      w(`# ${op.summary || op.operationId}  [${op.method} ${op.pathTemplate}]`);
      if (op.authScheme) w(`# Auth: ${op.authScheme} (set the matching env var above)`);
      if (argNames.length > 0) w(`# Args: ${argList}`);
      if (op.queryParams.length > 0) w(`# Sample: ${shFn} ${argNames.slice(0, argNames.length - 1).map(() => "VAL").join(" ")} ${sample}`.trim());
      w(`${shFn}() {`);

      const positional = op.pathParams.map((_p, i) => `$${i + 1}`);
      let urlPath = op.pathTemplate;
      op.pathParams.forEach((p, i) => {
        urlPath = urlPath.replace(`{${p.name}}`, positional[i]);
      });

      // Body arg index (1-based) lives at pathParams.length + 1.
      const bodyIdx = op.pathParams.length + 1;
      const queryIdx = bodyIdx + (op.hasBody ? 1 : 0);

      // Build the curl call line-by-line for readability.
      w("  local url=\"$CLOUDCDN_BASE_URL" + urlPath + "\"");
      if (op.queryParams.length > 0) {
        w(`  local qs="\${${queryIdx}:-}"`);
        w('  [[ -n "$qs" ]] && url+="?$qs"');
      }
      const verb = op.method === "GET" ? "" : `-X ${op.method} `;
      w("  curl -sS --fail-with-body \\");
      if (op.method !== "GET") {
        if (op.method === "HEAD") w("    -I \\");
        else w(`    -X ${op.method} \\`);
      }
      if (op.authScheme) {
        // Single quote the env-expanded header value at call time via $(...)
        w(`    $(__cloudcdn_auth_flag '${op.authScheme}') \\`);
      }
      if (op.hasBody && op.isBinary) {
        w("    -H 'Content-Type: application/octet-stream' \\");
        w(`    --data-binary @"\${${bodyIdx}}" \\`);
      } else if (op.hasBody) {
        w("    -H 'Content-Type: application/json' \\");
        w(`    -d "\${${bodyIdx}}" \\`);
      }
      w("    \"$url\"");
      w("}");
      w("");
    }
  }

  return out.join("\n");
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

  writeFileSync(resolve(outDir, "javascript.js"), generateJavaScript(spec, ops));
  console.log(`  wrote javascript.js (${ops.length} operations)`);

  writeFileSync(resolve(outDir, "typescript.ts"), generateTypeScript(spec, ops));
  console.log(`  wrote typescript.ts (${ops.length} operations)`);

  writeFileSync(resolve(outDir, "python.py"), generatePython(spec, ops));
  console.log(`  wrote python.py (${ops.length} operations)`);

  writeFileSync(resolve(outDir, "curl.sh"), generateCurl(spec, ops));
  console.log(`  wrote curl.sh (${ops.length} operations)`);

  console.log(`\nGenerated ${ops.length} endpoint wrappers across 4 languages.`);
  return { ops: ops.length, files: 4 };
}

// Run when invoked directly.
const isMain = process.argv[1] && (
  process.argv[1].endsWith("generate-client-libs.mjs") ||
  process.argv[1] === fileURLToPath(import.meta.url)
);
if (isMain) main();
