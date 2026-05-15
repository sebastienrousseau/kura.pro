#!/usr/bin/env node
/**
 * One-shot script to fill the 5 gaps between functions/api/*.js and
 * cdn/en/api-reference/openapi.json.
 *
 *   GET    /api/logs                          — operations log inspection
 *   POST   /api/pipeline                      — single-SVG zone scaffold
 *   GET, POST, DELETE /api/tokens             — scoped API token management
 *   GET, POST, DELETE /api/webhooks           — webhook registration
 *   POST   /api/passkeys/{flow}/{step}        — WebAuthn flows
 *   GET, DELETE /api/passkeys                 — passkey list/revoke
 *
 * Idempotent: skips paths that already exist. Adds the three new tags
 * (Operations, Auth, Webhooks) when missing.
 *
 * Run:  node scripts/add-missing-openapi.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'cdn/en/api-reference/openapi.json',
);
const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));

// ── Tags ────────────────────────────────────────────────────────────────
const newTags = [
  { name: 'Operations', description: 'Runtime telemetry and dispatch log inspection.' },
  { name: 'Auth',       description: 'WebAuthn passkey enrollment, authentication, and scoped API token management.' },
  { name: 'Webhooks',   description: 'Webhook registration, listing, and revocation.' },
];
for (const t of newTags) {
  if (!spec.tags.find((x) => x.name === t.name)) spec.tags.push(t);
}

// ── New paths ───────────────────────────────────────────────────────────
const paths = {
  '/api/logs': {
    get: {
      operationId: 'getLogs',
      summary: 'Stream or fetch operational logs',
      description:
        'Returns the worker request log buffered in KV. Use `?stream=1` for SSE; otherwise a JSON page is returned. Useful for live debugging and post-incident analysis.',
      tags: ['Operations'],
      security: [{ AccountKey: [] }],
      parameters: [
        { name: 'stream', in: 'query', required: false, schema: { type: 'boolean' },
          description: 'When `true`, returns Server-Sent Events instead of a JSON snapshot.' },
        { name: 'limit',  in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          description: 'Max records to return (JSON mode only).' },
        { name: 'since',  in: 'query', required: false, schema: { type: 'string', format: 'date-time' },
          description: 'Filter to records emitted at or after this ISO-8601 timestamp.' },
      ],
      responses: {
        200: {
          description: 'JSON log page (or SSE stream).',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  records: { type: 'array', items: { type: 'object' } },
                  count:   { type: 'integer' },
                  cursor:  { type: 'string', nullable: true },
                },
              },
            },
            'text/event-stream': {
              schema: { type: 'string', description: 'SSE: each line is a JSON log record.' },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        503: { description: 'KV binding unavailable.' },
      },
    },
  },

  '/api/pipeline': {
    post: {
      operationId: 'pipelineIngest',
      summary: 'Scaffold a zone or stock asset from a single SVG',
      description:
        'Single-SVG ingest. Generates the full directory tree (logos, banners, icons, favicon, PWA manifest) and commits it via the GitHub API. Two modes: `client` creates a new tenant zone; `stock` adds to the shared stock pool.',
      tags: ['Delivery'],
      security: [{ AccountKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['mode', 'name', 'svg'],
              properties: {
                mode: { type: 'string', enum: ['client', 'stock'], description: 'Pipeline mode.' },
                name: { type: 'string', description: 'Zone slug (client) or asset slug (stock). lower-kebab-case.' },
                svg:  { type: 'string', description: 'Base64-encoded SVG payload.' },
                generateIcons:   { type: 'boolean', default: true, description: 'Emit 180/192/512 PNG icons.' },
                generateBanners: { type: 'boolean', default: true, description: 'Emit social-share banners.' },
              },
            },
            examples: {
              client: {
                summary: 'Scaffold a new tenant zone',
                value: { mode: 'client', name: 'newbrand', svg: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIC4uLg==' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Ingest committed. Returns the commit SHA and the generated file list.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  commit: { type: 'string', description: 'Git commit SHA.' },
                  files:  { type: 'array', items: { type: 'string' } },
                  zone:   { type: 'string' },
                },
              },
            },
          },
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        409: { description: 'Zone or asset slug already exists.' },
        502: { description: 'GitHub API upstream error.' },
      },
    },
  },

  '/api/tokens': {
    get: {
      operationId: 'listTokens',
      summary: 'List API tokens (redacted)',
      description: 'Returns all tokens for the account. Full token values are never exposed — only the prefix, scopes, and timestamps.',
      tags: ['Auth'],
      security: [{ AccountKey: [] }],
      responses: {
        200: {
          description: 'Token list.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  tokens: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id:         { type: 'string' },
                        name:       { type: 'string' },
                        prefix:     { type: 'string', description: 'First 8 chars of the token (for identification).' },
                        scopes:     { type: 'array', items: { type: 'string' } },
                        createdAt:  { type: 'string', format: 'date-time' },
                        expiresAt:  { type: 'string', format: 'date-time', nullable: true },
                        lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
    post: {
      operationId: 'createToken',
      summary: 'Create a scoped API token',
      description:
        'Mints a new API token with the given scopes. The plaintext token is returned **once** in the response — store it; it cannot be retrieved again. SHA-256 hashed at rest.',
      tags: ['Auth'],
      security: [{ AccountKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name', 'scopes'],
              properties: {
                name:      { type: 'string', description: 'Human-readable label.' },
                scopes:    {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: [
                      'storage:read', 'storage:write',
                      'assets:read',
                      'insights:read',
                      'zones:read', 'zones:write',
                      'purge:write',
                      'pipeline:write',
                      'webhooks:read', 'webhooks:write',
                    ],
                  },
                },
                expiresAt: { type: 'string', format: 'date-time', nullable: true },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Token created. The plaintext token is in the response — store it.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  id:    { type: 'string' },
                  token: { type: 'string', description: 'The plaintext token. Shown once.' },
                  name:  { type: 'string' },
                  scopes: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
    delete: {
      operationId: 'revokeToken',
      summary: 'Revoke an API token',
      description: 'Permanently revokes the token by ID. Subsequent requests using this token return 401.',
      tags: ['Auth'],
      security: [{ AccountKey: [] }],
      parameters: [
        { name: 'id', in: 'query', required: true, schema: { type: 'string' }, description: 'Token ID.' },
      ],
      responses: {
        204: { description: 'Revoked.' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { description: 'No token with that ID.' },
      },
    },
  },

  '/api/webhooks': {
    get: {
      operationId: 'listWebhooks',
      summary: 'List registered webhooks',
      tags: ['Webhooks'],
      security: [{ AccountKey: [] }],
      responses: {
        200: {
          description: 'Webhook list.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  webhooks: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id:        { type: 'string' },
                        url:       { type: 'string', format: 'uri' },
                        events:    { type: 'array', items: { type: 'string' } },
                        createdAt: { type: 'string', format: 'date-time' },
                        active:    { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
    post: {
      operationId: 'registerWebhook',
      summary: 'Register a webhook',
      description:
        'Subscribes the given URL to one or more event types. Deliveries are signed (HMAC-SHA256) and fan-out via a Cloudflare Queue + DLQ for at-least-once semantics. Failed deliveries are retried with exponential backoff.',
      tags: ['Webhooks'],
      security: [{ AccountKey: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['url', 'events'],
              properties: {
                url:    { type: 'string', format: 'uri', description: 'HTTPS endpoint to receive event payloads.' },
                events: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: [
                      'asset.created', 'asset.deleted', 'asset.updated',
                      'zone.created', 'zone.deleted',
                      'purge.completed',
                      'pipeline.completed',
                    ],
                  },
                },
                secret: { type: 'string', description: 'Optional HMAC signing secret. If omitted, one is generated and returned.' },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Webhook registered.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  id:     { type: 'string' },
                  url:    { type: 'string', format: 'uri' },
                  events: { type: 'array', items: { type: 'string' } },
                  secret: { type: 'string', description: 'HMAC signing secret. Returned once.' },
                },
              },
            },
          },
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
    delete: {
      operationId: 'deleteWebhook',
      summary: 'Delete a webhook',
      tags: ['Webhooks'],
      security: [{ AccountKey: [] }],
      parameters: [
        { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        204: { description: 'Deleted.' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { description: 'No webhook with that ID.' },
      },
    },
  },

  '/api/passkeys': {
    get: {
      operationId: 'listPasskeys',
      summary: 'List registered passkeys',
      description: 'Returns metadata for every registered passkey for the authenticated user. Credential IDs are exposed; the raw public keys are not.',
      tags: ['Auth'],
      security: [{ SessionCookie: [] }],
      responses: {
        200: {
          description: 'Passkey list.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  passkeys: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id:           { type: 'string' },
                        name:         { type: 'string' },
                        createdAt:    { type: 'string', format: 'date-time' },
                        lastUsedAt:   { type: 'string', format: 'date-time', nullable: true },
                        deviceType:   { type: 'string', enum: ['single_device', 'multi_device'], nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
    delete: {
      operationId: 'revokePasskey',
      summary: 'Revoke a passkey',
      tags: ['Auth'],
      security: [{ SessionCookie: [] }],
      parameters: [
        { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        204: { description: 'Revoked.' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { description: 'No passkey with that ID.' },
      },
    },
  },

  '/api/passkeys/register/begin': {
    post: {
      operationId: 'passkeyRegisterBegin',
      summary: 'Start passkey registration — get a challenge',
      description: 'Returns a WebAuthn `PublicKeyCredentialCreationOptions` payload. Pass the resulting credential to `/api/passkeys/register/complete`.',
      tags: ['Auth'],
      security: [{ SessionCookie: [] }],
      responses: {
        200: {
          description: 'Registration options.',
          content: { 'application/json': { schema: { type: 'object', description: 'WebAuthn PublicKeyCredentialCreationOptions.' } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/api/passkeys/register/complete': {
    post: {
      operationId: 'passkeyRegisterComplete',
      summary: 'Complete passkey registration',
      description: 'Verifies the WebAuthn attestation, stores the credential, and returns the persisted passkey metadata.',
      tags: ['Auth'],
      security: [{ SessionCookie: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['credential', 'name'],
              properties: {
                credential: { type: 'object', description: 'WebAuthn AuthenticatorAttestationResponse.' },
                name:       { type: 'string', description: 'Human-readable label (e.g. "MacBook Pro").' },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Passkey registered.' },
        400: { description: 'Invalid attestation.' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/api/passkeys/auth/begin': {
    post: {
      operationId: 'passkeyAuthBegin',
      summary: 'Start passkey authentication — get a challenge',
      description: 'Returns a WebAuthn `PublicKeyCredentialRequestOptions` payload. Public endpoint (no session required).',
      tags: ['Auth'],
      responses: {
        200: {
          description: 'Authentication options.',
          content: { 'application/json': { schema: { type: 'object', description: 'WebAuthn PublicKeyCredentialRequestOptions.' } } },
        },
      },
    },
  },

  '/api/passkeys/auth/complete': {
    post: {
      operationId: 'passkeyAuthComplete',
      summary: 'Complete passkey authentication',
      description: 'Verifies the assertion. On success, sets the `cdn_session` cookie (HMAC-signed, HttpOnly, Secure, 7-day TTL).',
      tags: ['Auth'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['credential'],
              properties: {
                credential: { type: 'object', description: 'WebAuthn AuthenticatorAssertionResponse.' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Authenticated. `Set-Cookie: cdn_session=...` on the response.',
          headers: {
            'Set-Cookie': { schema: { type: 'string' }, description: 'HMAC-signed session cookie.' },
          },
        },
        400: { description: 'Invalid assertion.' },
        401: { description: 'Assertion verification failed.' },
      },
    },
  },
};

// Add a SessionCookie security scheme if absent (passkey list/delete use it).
spec.components.securitySchemes = spec.components.securitySchemes || {};
if (!spec.components.securitySchemes.SessionCookie) {
  spec.components.securitySchemes.SessionCookie = {
    type: 'apiKey',
    in: 'cookie',
    name: 'cdn_session',
    description: 'HMAC-signed session cookie issued by `/api/passkeys/auth/complete` or `POST /dashboard/login`.',
  };
}

// Add shared responses if absent.
spec.components.responses = spec.components.responses || {};
for (const [name, body] of Object.entries({
  Unauthorized: {
    description: 'Missing or invalid credentials.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  BadRequest: {
    description: 'Request validation failed.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
})) {
  if (!spec.components.responses[name]) spec.components.responses[name] = body;
}

// Merge new paths (skip ones already present).
let added = 0;
let skipped = 0;
for (const [p, ops] of Object.entries(paths)) {
  if (spec.paths[p]) { skipped++; continue; }
  spec.paths[p] = ops;
  added++;
}

fs.writeFileSync(SPEC, JSON.stringify(spec, null, 2) + '\n');
console.log(`openapi: added ${added} new paths, skipped ${skipped} existing`);
console.log(`         tags: ${spec.tags.map((t) => t.name).join(', ')}`);
console.log(`         total paths now: ${Object.keys(spec.paths).length}`);
