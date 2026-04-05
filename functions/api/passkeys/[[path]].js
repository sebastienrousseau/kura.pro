/**
 * Catch-all route for /api/passkeys/* sub-paths.
 * Delegates to the main passkeys handler which routes by URL suffix.
 */

export { onRequestPost, onRequestGet, onRequestDelete, onRequestOptions } from './index.js';
