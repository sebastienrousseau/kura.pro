#!/usr/bin/env node
/**
 * Patch all HTTP response messages to be:
 * - Consistent format: sentence case, period-terminated
 * - Descriptive: explain what happened AND what to do
 * - Minimum 150 characters
 * - Standards-compliant (RFC 9110 semantics)
 */

import fs from 'fs';
import path from 'path';

// Map of short messages → standardized long messages
const MESSAGE_MAP = {
  // ── Auth ──
  'Unauthorized': 'Authentication required. Provide a valid API key in the request header. Use "AccessKey" for storage and asset operations, or "AccountKey" for zone management and analytics.',
  'Unauthorized. Use AccountKey header.': 'Authentication required. Provide your AccountKey in the request header to access zone management, analytics, and configuration endpoints. Contact support if you need a key.',

  // ── Validation ──
  'Invalid JSON': 'The request body contains invalid JSON and could not be parsed. Verify the payload is well-formed JSON with correct syntax, including matching brackets and properly quoted strings.',
  'Invalid JSON body': 'The request body contains invalid JSON and could not be parsed. Verify the payload is well-formed JSON with correct syntax, including matching brackets and properly quoted strings.',
  'Invalid path': 'The requested path is invalid or contains disallowed characters such as path traversal sequences. Use forward slashes to separate path segments and avoid ".." or empty segments.',
  'Invalid file path': 'The requested file path is invalid. Ensure the path points to a specific file (not a directory), uses forward slashes, and does not contain path traversal sequences like "..".',
  'Invalid zone ID': 'The zone identifier is invalid. Zone IDs must be alphanumeric strings with hyphens, between 2 and 64 characters long. Avoid special characters and path traversal sequences.',
  'Zone ID required': 'A zone identifier is required in the URL path. Use the format /api/core/zones/{zone-id} where zone-id matches the project directory name (e.g., "akande", "bankingonai").',
  'Content must be a string': 'The "Content" field must be a string containing the file contents. For _headers and _redirects files, provide the full file content as a single string with newline characters.',
  'Content too large (max 100KB)': 'The submitted content exceeds the 100 KB size limit for edge configuration files. Reduce the content size by removing unnecessary rules or consolidating duplicate entries.',

  // ── Not Found ──
  'File not found': 'The requested file does not exist at the specified path. Verify the path is correct, check for typos in the filename or directory structure, and confirm the file has been uploaded.',
  'Manifest unavailable': 'The asset manifest could not be loaded from the edge cache. This may indicate a deployment is in progress. Retry the request in a few seconds or check the system status.',

  // ── Server Errors ──
  'Upload failed': 'The file upload failed due to an unexpected error communicating with the storage backend. Verify your GITHUB_TOKEN has write permissions and the repository is accessible.',
  'Delete failed': 'The file deletion failed due to an unexpected error communicating with the storage backend. Verify your GITHUB_TOKEN has write permissions and the file exists at the specified path.',
  'Update failed': 'The edge configuration update failed due to an unexpected error. Verify your GITHUB_TOKEN has write permissions to the repository and the file content is valid for Cloudflare Pages.',
  'Download failed': 'The file download failed due to an unexpected internal error. The asset may have been recently deleted or the edge cache may be refreshing. Retry the request in a few seconds.',
  'Domain addition failed': 'The custom domain could not be added via the Cloudflare Pages API. Verify that CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are correctly configured with sufficient permissions.',
  'Analytics unavailable': 'The analytics data store (Cloudflare KV) is currently unavailable. This may be a temporary issue with the edge network. Retry the request in a few seconds or check system status.',
  'Analytics store unavailable': 'The analytics data store (Cloudflare KV) is currently unavailable. This may be a temporary issue with the edge network. Retry the request in a few seconds or check system status.',
  'Checksum mismatch': 'The SHA-256 checksum provided in the Checksum header does not match the computed hash of the uploaded file body. Verify the file was not corrupted during transfer and the hash is correct.',

  // ── Config ──
  'Requires GITHUB_TOKEN and GITHUB_REPO': 'This operation requires the GITHUB_TOKEN and GITHUB_REPO environment variables to be configured. Set these in your Cloudflare Pages project settings to enable GitOps mutations.',
  'Upload requires GITHUB_TOKEN and GITHUB_REPO environment variables': 'File uploads require the GITHUB_TOKEN and GITHUB_REPO environment variables to be configured. Set these in your Cloudflare Pages project settings under Environment Variables.',
  'Delete requires GITHUB_TOKEN and GITHUB_REPO environment variables': 'File deletions require the GITHUB_TOKEN and GITHUB_REPO environment variables to be configured. Set these in your Cloudflare Pages project settings under Environment Variables.',
  'Batch upload requires GITHUB_TOKEN and GITHUB_REPO environment variables': 'Batch uploads require the GITHUB_TOKEN and GITHUB_REPO environment variables to be configured. Set these in your Cloudflare Pages project settings under Environment Variables.',
  'Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN': 'Custom domain management requires the CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables. Set these in your Cloudflare Pages project settings.',

  // ── Success ──
  'File uploaded successfully': 'File uploaded successfully. The asset has been committed to the repository and will be available at the edge after the CI/CD pipeline completes deployment (approximately 60-90 seconds).',
  'File deleted successfully': 'File deleted successfully. The asset has been removed from the repository and the edge cache purge has been initiated. The deletion will propagate to all 300+ edge locations within seconds.',

  // ── Batch ──
  'Each file must have path and content fields': 'Each file object in the batch array must include both "path" (string, the destination path) and "content" (string, base64-encoded file data). Optional: "encoding" defaults to "base64".',
  'files array is required and must not be empty': 'The request body must include a "files" array containing at least one file object. Each object requires "path" and "content" fields. Maximum batch size is 50 files per request.',
};

export function patchMessages(dir) {
  let patched = 0;
  const files = [];

  function scan(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.includes('.test.')) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  }
  scan(dir);

  for (const file of files) {
    let content = fs.readFileSync(file, 'utf-8');
    let changed = false;

    for (const [short, long] of Object.entries(MESSAGE_MAP)) {
      // Match Message: 'short' or Message: "short"
      const patterns = [
        `Message: '${short}'`,
        `Message: "${short}"`,
        `Message: \`${short}\``,
      ];
      for (const pattern of patterns) {
        if (content.includes(pattern)) {
          content = content.replaceAll(pattern, `Message: '${long}'`);
          changed = true;
          patched++;
        }
      }
    }

    if (changed) fs.writeFileSync(file, content);
  }

  console.log(`Patched ${patched} messages across ${files.length} files.`);
  return patched;
}

const isMain = process.argv[1]?.endsWith('patch-messages.mjs');
if (isMain) patchMessages(path.join(process.cwd(), 'functions'));
