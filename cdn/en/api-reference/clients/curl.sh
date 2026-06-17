#!/usr/bin/env bash
# CloudCDN API Client -- cURL helpers.
# Auto-generated from openapi.json -- do not edit manually.
#
# Base URL: https://cloudcdn.pro
#
# Usage:
#   source curl.sh                                # load the helpers
#   export CLOUDCDN_ACCESS_KEY=sk_live_...        # configure auth
#   listAssets 'project=akande&format=svg'        # call any function
#
# Environment variables:
#   CLOUDCDN_BASE_URL       (default: https://cloudcdn.pro)
#   CLOUDCDN_ACCESS_KEY     storage / assets / insights
#   CLOUDCDN_ACCOUNT_KEY    core / pipeline / audit / webhooks / tokens
#   CLOUDCDN_PURGE_KEY      cache purge
#   CLOUDCDN_ANALYTICS_KEY  analytics
#   CLOUDCDN_BEARER_TOKEN   scoped Bearer token (overrides per-scheme keys)
#
# Every helper passes --fail-with-body so non-2xx responses are printed
# and the helper exits non-zero -- safe to chain in scripts.

CLOUDCDN_BASE_URL="${CLOUDCDN_BASE_URL:-https://cloudcdn.pro}"

# Internal: emit the right auth flag for the OpenAPI security scheme.
__cloudcdn_auth_flag() {
  case "$1" in
    AccessKey)    [[ -n "${CLOUDCDN_ACCESS_KEY:-}" ]]    && echo "-H AccessKey: ${CLOUDCDN_ACCESS_KEY}" ;;
    AccountKey)   [[ -n "${CLOUDCDN_ACCOUNT_KEY:-}" ]]   && echo "-H AccountKey: ${CLOUDCDN_ACCOUNT_KEY}" ;;
    PurgeKey)     [[ -n "${CLOUDCDN_PURGE_KEY:-}" ]]     && echo "-H x-api-key: ${CLOUDCDN_PURGE_KEY}" ;;
    AnalyticsKey) [[ -n "${CLOUDCDN_ANALYTICS_KEY:-}" ]] && echo "-H x-api-key: ${CLOUDCDN_ANALYTICS_KEY}" ;;
    BearerToken)  [[ -n "${CLOUDCDN_BEARER_TOKEN:-}" ]]  && echo "-H Authorization: Bearer ${CLOUDCDN_BEARER_TOKEN}" ;;
  esac
}

# ---------------------------------------------------------------------------
# AI
# ---------------------------------------------------------------------------

# Generate alt text (GET)  [GET /api/ai/alt-text]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: altTextGet  'project=akande&limit=5'
altTextGet() {
  local url="$CLOUDCDN_BASE_URL/api/ai/alt-text"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Generate alt text (POST)  [POST /api/ai/alt-text]
# Auth: AccountKey (set the matching env var above)
# Args: json_body
altTextPost() {
  local url="$CLOUDCDN_BASE_URL/api/ai/alt-text"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'AccountKey') \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# Remove image background (not yet implemented)  [GET /api/ai/background-remove]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: backgroundRemoveGet  'project=akande&limit=5'
backgroundRemoveGet() {
  local url="$CLOUDCDN_BASE_URL/api/ai/background-remove"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Remove image background (not yet implemented)  [POST /api/ai/background-remove]
# Auth: AccountKey (set the matching env var above)
# Args: json_body
backgroundRemovePost() {
  local url="$CLOUDCDN_BASE_URL/api/ai/background-remove"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'AccountKey') \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# AI Chat Concierge  [POST /api/chat]
# Args: json_body
chatConcierge() {
  local url="$CLOUDCDN_BASE_URL/api/chat"
  curl -sS --fail-with-body \
    -X POST \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# Service health and binding status  [GET /api/health]
# Args: query_string
# Sample: healthCheck  'project=akande&limit=5'
healthCheck() {
  local url="$CLOUDCDN_BASE_URL/api/health"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    "$url"
}

# AI image moderation (GET)  [GET /api/ai/moderate]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: moderateGet  'project=akande&limit=5'
moderateGet() {
  local url="$CLOUDCDN_BASE_URL/api/ai/moderate"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# AI image moderation (POST)  [POST /api/ai/moderate]
# Auth: AccountKey (set the matching env var above)
# Args: json_body
moderatePost() {
  local url="$CLOUDCDN_BASE_URL/api/ai/moderate"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'AccountKey') \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# Semantic asset search  [GET /api/search]
# Args: query_string
# Sample: searchAssets  'project=akande&limit=5'
searchAssets() {
  local url="$CLOUDCDN_BASE_URL/api/search"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    "$url"
}

# AI smart-crop gravity (GET)  [GET /api/ai/smart-crop]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: smartCropGet  'project=akande&limit=5'
smartCropGet() {
  local url="$CLOUDCDN_BASE_URL/api/ai/smart-crop"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# AI smart-crop gravity (POST)  [POST /api/ai/smart-crop]
# Auth: AccountKey (set the matching env var above)
# Args: json_body
smartCropPost() {
  local url="$CLOUDCDN_BASE_URL/api/ai/smart-crop"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'AccountKey') \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------

# Get asset metadata  [GET /api/assets/metadata]
# Auth: AccessKey (set the matching env var above)
# Args: query_string
# Sample: getAssetMetadata  'project=akande&limit=5'
getAssetMetadata() {
  local url="$CLOUDCDN_BASE_URL/api/assets/metadata"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccessKey') \
    "$url"
}

# List assets  [GET /api/assets]
# Auth: AccessKey (set the matching env var above)
# Args: query_string
# Sample: listAssets  'project=akande&limit=5'
listAssets() {
  local url="$CLOUDCDN_BASE_URL/api/assets"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccessKey') \
    "$url"
}

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

# Create a scoped API token  [POST /api/tokens]
# Auth: AccountKey (set the matching env var above)
# Args: json_body
createToken() {
  local url="$CLOUDCDN_BASE_URL/api/tokens"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'AccountKey') \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# List registered passkeys  [GET /api/passkeys]
# Auth: SessionCookie (set the matching env var above)
listPasskeys() {
  local url="$CLOUDCDN_BASE_URL/api/passkeys"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'SessionCookie') \
    "$url"
}

# List API tokens (redacted)  [GET /api/tokens]
# Auth: AccountKey (set the matching env var above)
listTokens() {
  local url="$CLOUDCDN_BASE_URL/api/tokens"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Start passkey authentication — get a challenge  [POST /api/passkeys/auth/begin]
passkeyAuthBegin() {
  local url="$CLOUDCDN_BASE_URL/api/passkeys/auth/begin"
  curl -sS --fail-with-body \
    -X POST \
    "$url"
}

# Complete passkey authentication  [POST /api/passkeys/auth/complete]
# Args: json_body
passkeyAuthComplete() {
  local url="$CLOUDCDN_BASE_URL/api/passkeys/auth/complete"
  curl -sS --fail-with-body \
    -X POST \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# Start passkey registration — get a challenge  [POST /api/passkeys/register/begin]
# Auth: SessionCookie (set the matching env var above)
passkeyRegisterBegin() {
  local url="$CLOUDCDN_BASE_URL/api/passkeys/register/begin"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'SessionCookie') \
    "$url"
}

# Complete passkey registration  [POST /api/passkeys/register/complete]
# Auth: SessionCookie (set the matching env var above)
# Args: json_body
passkeyRegisterComplete() {
  local url="$CLOUDCDN_BASE_URL/api/passkeys/register/complete"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'SessionCookie') \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# Revoke a passkey  [DELETE /api/passkeys]
# Auth: SessionCookie (set the matching env var above)
# Args: query_string
# Sample: revokePasskey  'project=akande&limit=5'
revokePasskey() {
  local url="$CLOUDCDN_BASE_URL/api/passkeys"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    -X DELETE \
    $(__cloudcdn_auth_flag 'SessionCookie') \
    "$url"
}

# Revoke an API token  [DELETE /api/tokens]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: revokeToken  'project=akande&limit=5'
revokeToken() {
  local url="$CLOUDCDN_BASE_URL/api/tokens"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    -X DELETE \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------

# Add custom domain to zone  [POST /api/core/zones/{id}/domains]
# Auth: AccountKey (set the matching env var above)
# Args: id json_body
addDomain() {
  local url="$CLOUDCDN_BASE_URL/api/core/zones/$1/domains"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'AccountKey') \
    -H 'Content-Type: application/json' \
    -d "${2}" \
    "$url"
}

# Audit log reader  [GET /api/core/audit-logs]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: auditLogs  'project=akande&limit=5'
auditLogs() {
  local url="$CLOUDCDN_BASE_URL/api/core/audit-logs"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Create a new zone  [POST /api/core/zones]
# Auth: AccountKey (set the matching env var above)
# Args: json_body
createZone() {
  local url="$CLOUDCDN_BASE_URL/api/core/zones"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'AccountKey') \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# Delete zone  [DELETE /api/core/zones/{id}]
# Auth: AccountKey (set the matching env var above)
# Args: id
deleteZone() {
  local url="$CLOUDCDN_BASE_URL/api/core/zones/$1"
  curl -sS --fail-with-body \
    -X DELETE \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Read edge rules  [GET /api/core/rules]
# Auth: AccountKey (set the matching env var above)
getRules() {
  local url="$CLOUDCDN_BASE_URL/api/core/rules"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Get edge statistics  [GET /api/core/statistics]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: getStatistics  'project=akande&limit=5'
getStatistics() {
  local url="$CLOUDCDN_BASE_URL/api/core/statistics"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Get zone details  [GET /api/core/zones/{id}]
# Auth: AccountKey (set the matching env var above)
# Args: id
getZone() {
  local url="$CLOUDCDN_BASE_URL/api/core/zones/$1"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# List all zones  [GET /api/core/zones]
# Auth: AccountKey (set the matching env var above)
listZones() {
  local url="$CLOUDCDN_BASE_URL/api/core/zones"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Update edge rules  [POST /api/core/rules]
# Auth: AccountKey (set the matching env var above)
# Args: json_body
updateRules() {
  local url="$CLOUDCDN_BASE_URL/api/core/rules"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'AccountKey') \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# ---------------------------------------------------------------------------
# Delivery
# ---------------------------------------------------------------------------

# Automatic format negotiation  [GET /api/auto]
# Args: query_string
# Sample: autoFormat  'project=akande&limit=5'
autoFormat() {
  local url="$CLOUDCDN_BASE_URL/api/auto"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    "$url"
}

# Path-based automatic format negotiation  [GET /api/auto/{path}]
# Args: path
autoFormatPath() {
  local url="$CLOUDCDN_BASE_URL/api/auto/$1"
  curl -sS --fail-with-body \
    "$url"
}

# Content-addressable placeholder hash  [GET /api/blurhash]
# Args: query_string
# Sample: blurhash  'project=akande&limit=5'
blurhash() {
  local url="$CLOUDCDN_BASE_URL/api/blurhash"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    "$url"
}

# Low-quality image placeholder  [GET /api/lqip]
# Args: query_string
# Sample: lqip  'project=akande&limit=5'
lqip() {
  local url="$CLOUDCDN_BASE_URL/api/lqip"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    "$url"
}

# Scaffold a zone or stock asset from a single SVG  [POST /api/pipeline]
# Auth: AccountKey (set the matching env var above)
# Args: json_body
pipelineIngest() {
  local url="$CLOUDCDN_BASE_URL/api/pipeline"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'AccountKey') \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# Purge CDN cache  [POST /api/purge]
# Auth: PurgeKey (set the matching env var above)
# Args: json_body
purgeCache() {
  local url="$CLOUDCDN_BASE_URL/api/purge"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'PurgeKey') \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# HLS video streaming  [GET /api/stream]
# Args: query_string
# Sample: streamVideo  'project=akande&limit=5'
streamVideo() {
  local url="$CLOUDCDN_BASE_URL/api/stream"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    "$url"
}

# Transform image  [GET /api/transform]
# Args: query_string
# Sample: transformImage  'project=akande&limit=5'
transformImage() {
  local url="$CLOUDCDN_BASE_URL/api/transform"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    "$url"
}

# Verify signed URL  [GET /api/signed]
# Args: query_string
# Sample: verifySignedUrl  'project=akande&limit=5'
verifySignedUrl() {
  local url="$CLOUDCDN_BASE_URL/api/signed"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    "$url"
}

# ---------------------------------------------------------------------------
# Insights
# ---------------------------------------------------------------------------

# Get analytics report  [GET /api/analytics]
# Auth: AnalyticsKey (set the matching env var above)
# Args: query_string
# Sample: getAnalytics  'project=akande&limit=5'
getAnalytics() {
  local url="$CLOUDCDN_BASE_URL/api/analytics"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AnalyticsKey') \
    "$url"
}

# Error tracking  [GET /api/insights/errors]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: getErrors  'project=akande&limit=5'
getErrors() {
  local url="$CLOUDCDN_BASE_URL/api/insights/errors"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Geographic distribution  [GET /api/insights/geography]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: getGeography  'project=akande&limit=5'
getGeography() {
  local url="$CLOUDCDN_BASE_URL/api/insights/geography"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Analytics summary  [GET /api/insights/summary]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: getInsightsSummary  'project=akande&limit=5'
getInsightsSummary() {
  local url="$CLOUDCDN_BASE_URL/api/insights/summary"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Top requested assets  [GET /api/insights/top-assets]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: getTopAssets  'project=akande&limit=5'
getTopAssets() {
  local url="$CLOUDCDN_BASE_URL/api/insights/top-assets"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Per-asset analytics  [GET /api/insights/asset]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: insightsAsset  'project=akande&limit=5'
insightsAsset() {
  local url="$CLOUDCDN_BASE_URL/api/insights/asset"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Record analytics hit  [POST /api/analytics]
# Args: json_body
trackAnalytics() {
  local url="$CLOUDCDN_BASE_URL/api/analytics"
  curl -sS --fail-with-body \
    -X POST \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

# Stream or fetch operational logs  [GET /api/logs]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: getLogs  'project=akande&limit=5'
getLogs() {
  local url="$CLOUDCDN_BASE_URL/api/logs"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

# Batch upload files  [POST /api/storage/batch]
# Auth: AccessKey (set the matching env var above)
# Args: json_body
storageBatchUpload() {
  local url="$CLOUDCDN_BASE_URL/api/storage/batch"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'AccessKey') \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}

# Delete file  [DELETE /api/storage/{path}]
# Auth: AccessKey (set the matching env var above)
# Args: path
storageDelete() {
  local url="$CLOUDCDN_BASE_URL/api/storage/$1"
  curl -sS --fail-with-body \
    -X DELETE \
    $(__cloudcdn_auth_flag 'AccessKey') \
    "$url"
}

# List directory or download file  [GET /api/storage/{path}]
# Auth: AccessKey (set the matching env var above)
# Args: path
storageGetOrList() {
  local url="$CLOUDCDN_BASE_URL/api/storage/$1"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccessKey') \
    "$url"
}

# File metadata (HEAD)  [HEAD /api/storage/{path}]
# Auth: AccessKey (set the matching env var above)
# Args: path
storageHead() {
  local url="$CLOUDCDN_BASE_URL/api/storage/$1"
  curl -sS --fail-with-body \
    -I \
    $(__cloudcdn_auth_flag 'AccessKey') \
    "$url"
}

# Upload file  [PUT /api/storage/{path}]
# Auth: AccessKey (set the matching env var above)
# Args: path file_path
storageUpload() {
  local url="$CLOUDCDN_BASE_URL/api/storage/$1"
  curl -sS --fail-with-body \
    -X PUT \
    $(__cloudcdn_auth_flag 'AccessKey') \
    -H 'Content-Type: application/octet-stream' \
    --data-binary @"${2}" \
    "$url"
}

# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------

# Delete a webhook  [DELETE /api/webhooks]
# Auth: AccountKey (set the matching env var above)
# Args: query_string
# Sample: deleteWebhook  'project=akande&limit=5'
deleteWebhook() {
  local url="$CLOUDCDN_BASE_URL/api/webhooks"
  local qs="${1:-}"
  [[ -n "$qs" ]] && url+="?$qs"
  curl -sS --fail-with-body \
    -X DELETE \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# List registered webhooks  [GET /api/webhooks]
# Auth: AccountKey (set the matching env var above)
listWebhooks() {
  local url="$CLOUDCDN_BASE_URL/api/webhooks"
  curl -sS --fail-with-body \
    $(__cloudcdn_auth_flag 'AccountKey') \
    "$url"
}

# Register a webhook  [POST /api/webhooks]
# Auth: AccountKey (set the matching env var above)
# Args: json_body
registerWebhook() {
  local url="$CLOUDCDN_BASE_URL/api/webhooks"
  curl -sS --fail-with-body \
    -X POST \
    $(__cloudcdn_auth_flag 'AccountKey') \
    -H 'Content-Type: application/json' \
    -d "${1}" \
    "$url"
}
