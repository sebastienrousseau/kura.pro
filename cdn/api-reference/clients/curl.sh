#!/usr/bin/env bash
# CloudCDN API Client -- cURL commands
# Auto-generated from openapi.json -- do not edit manually
#
# Base URL: https://cloudcdn.pro
#
# Usage: source this file, then call any function.
# All functions print the curl command to stdout and execute it.
#
# Configure these environment variables:
#   CLOUDCDN_BASE_URL  (default: "https://cloudcdn.pro")
#   CLOUDCDN_ACCESS_KEY
#   CLOUDCDN_ACCOUNT_KEY
#   CLOUDCDN_PURGE_KEY
#   CLOUDCDN_ANALYTICS_KEY

CLOUDCDN_BASE_URL="${CLOUDCDN_BASE_URL:-https://cloudcdn.pro}"

# List assets [GET /api/assets]
listAssets() {
  curl -s \
    -H "AccessKey: $CLOUDCDN_ACCESS_KEY" \
    "$CLOUDCDN_BASE_URL/api/assets"
}

# Get asset metadata [GET /api/assets/metadata]
getAssetMetadata() {
  curl -s \
    -H "AccessKey: $CLOUDCDN_ACCESS_KEY" \
    "$CLOUDCDN_BASE_URL/api/assets/metadata"
}

# List directory or download file [GET /api/storage/{path}]
storageGetOrList() {
  # Args: path
  curl -s \
    -H "AccessKey: $CLOUDCDN_ACCESS_KEY" \
    "$CLOUDCDN_BASE_URL/api/storage/$1"
}

# Upload file [PUT /api/storage/{path}]
storageUpload() {
  # Args: path, file_path
  curl -s \
    -X PUT \
    -H "AccessKey: $CLOUDCDN_ACCESS_KEY" \
    -H 'Content-Type: application/octet-stream' \
    --data-binary @"$2" \
    "$CLOUDCDN_BASE_URL/api/storage/$1"
}

# Delete file [DELETE /api/storage/{path}]
storageDelete() {
  # Args: path
  curl -s \
    -X DELETE \
    -H "AccessKey: $CLOUDCDN_ACCESS_KEY" \
    "$CLOUDCDN_BASE_URL/api/storage/$1"
}

# File metadata (HEAD) [HEAD /api/storage/{path}]
storageHead() {
  # Args: path
  curl -s \
    -I \
    -H "AccessKey: $CLOUDCDN_ACCESS_KEY" \
    "$CLOUDCDN_BASE_URL/api/storage/$1"
}

# Batch upload files [POST /api/storage/batch]
storageBatchUpload() {
  # Args: json_body
  curl -s \
    -X POST \
    -H "AccessKey: $CLOUDCDN_ACCESS_KEY" \
    -H 'Content-Type: application/json' \
    -d "$1" \
    "$CLOUDCDN_BASE_URL/api/storage/batch"
}

# List all zones [GET /api/core/zones]
listZones() {
  curl -s \
    -H "AccountKey: $CLOUDCDN_ACCOUNT_KEY" \
    "$CLOUDCDN_BASE_URL/api/core/zones"
}

# Create a new zone [POST /api/core/zones]
createZone() {
  # Args: json_body
  curl -s \
    -X POST \
    -H "AccountKey: $CLOUDCDN_ACCOUNT_KEY" \
    -H 'Content-Type: application/json' \
    -d "$1" \
    "$CLOUDCDN_BASE_URL/api/core/zones"
}

# Get zone details [GET /api/core/zones/{id}]
getZone() {
  # Args: id
  curl -s \
    -H "AccountKey: $CLOUDCDN_ACCOUNT_KEY" \
    "$CLOUDCDN_BASE_URL/api/core/zones/$1"
}

# Delete zone [DELETE /api/core/zones/{id}]
deleteZone() {
  # Args: id
  curl -s \
    -X DELETE \
    -H "AccountKey: $CLOUDCDN_ACCOUNT_KEY" \
    "$CLOUDCDN_BASE_URL/api/core/zones/$1"
}

# Add custom domain to zone [POST /api/core/zones/{id}/domains]
addDomain() {
  # Args: id, json_body
  curl -s \
    -X POST \
    -H "AccountKey: $CLOUDCDN_ACCOUNT_KEY" \
    -H 'Content-Type: application/json' \
    -d "$2" \
    "$CLOUDCDN_BASE_URL/api/core/zones/$1/domains"
}

# Get edge statistics [GET /api/core/statistics]
getStatistics() {
  curl -s \
    -H "AccountKey: $CLOUDCDN_ACCOUNT_KEY" \
    "$CLOUDCDN_BASE_URL/api/core/statistics"
}

# Read edge rules [GET /api/core/rules]
getRules() {
  curl -s \
    -H "AccountKey: $CLOUDCDN_ACCOUNT_KEY" \
    "$CLOUDCDN_BASE_URL/api/core/rules"
}

# Update edge rules [POST /api/core/rules]
updateRules() {
  # Args: json_body
  curl -s \
    -X POST \
    -H "AccountKey: $CLOUDCDN_ACCOUNT_KEY" \
    -H 'Content-Type: application/json' \
    -d "$1" \
    "$CLOUDCDN_BASE_URL/api/core/rules"
}

# Analytics summary [GET /api/insights/summary]
getInsightsSummary() {
  curl -s \
    -H "AccountKey: $CLOUDCDN_ACCOUNT_KEY" \
    "$CLOUDCDN_BASE_URL/api/insights/summary"
}

# Top requested assets [GET /api/insights/top-assets]
getTopAssets() {
  curl -s \
    -H "AccountKey: $CLOUDCDN_ACCOUNT_KEY" \
    "$CLOUDCDN_BASE_URL/api/insights/top-assets"
}

# Geographic distribution [GET /api/insights/geography]
getGeography() {
  curl -s \
    -H "AccountKey: $CLOUDCDN_ACCOUNT_KEY" \
    "$CLOUDCDN_BASE_URL/api/insights/geography"
}

# Error tracking [GET /api/insights/errors]
getErrors() {
  curl -s \
    -H "AccountKey: $CLOUDCDN_ACCOUNT_KEY" \
    "$CLOUDCDN_BASE_URL/api/insights/errors"
}

# Transform image [GET /api/transform]
transformImage() {
  curl -s \
    "$CLOUDCDN_BASE_URL/api/transform"
}

# Automatic format negotiation [GET /api/auto]
autoFormat() {
  curl -s \
    "$CLOUDCDN_BASE_URL/api/auto"
}

# Verify signed URL [GET /api/signed]
verifySignedUrl() {
  curl -s \
    "$CLOUDCDN_BASE_URL/api/signed"
}

# HLS video streaming [GET /api/stream]
streamVideo() {
  curl -s \
    "$CLOUDCDN_BASE_URL/api/stream"
}

# Purge CDN cache [POST /api/purge]
purgeCache() {
  # Args: json_body
  curl -s \
    -X POST \
    -H "x-api-key: $CLOUDCDN_PURGE_KEY" \
    -H 'Content-Type: application/json' \
    -d "$1" \
    "$CLOUDCDN_BASE_URL/api/purge"
}

# Get analytics report [GET /api/analytics]
getAnalytics() {
  curl -s \
    -H "x-api-key: $CLOUDCDN_ANALYTICS_KEY" \
    "$CLOUDCDN_BASE_URL/api/analytics"
}

# Record analytics hit [POST /api/analytics]
trackAnalytics() {
  # Args: json_body
  curl -s \
    -X POST \
    -H 'Content-Type: application/json' \
    -d "$1" \
    "$CLOUDCDN_BASE_URL/api/analytics"
}

# Semantic asset search [GET /api/search]
searchAssets() {
  curl -s \
    "$CLOUDCDN_BASE_URL/api/search"
}

# AI Chat Concierge [POST /api/chat]
chatConcierge() {
  # Args: json_body
  curl -s \
    -X POST \
    -H 'Content-Type: application/json' \
    -d "$1" \
    "$CLOUDCDN_BASE_URL/api/chat"
}

# ---------------------------------------------------------------------------
# Example usage:
# ---------------------------------------------------------------------------
#
#   export CLOUDCDN_ACCESS_KEY="your-key"
#   source website/api-reference/clients/curl.sh
#   listAssets  # lists assets
#   storageUpload "clients/akande/v1/logos/new.svg" ./new.svg
#   createZone '{"Name":"newclient"}'
#