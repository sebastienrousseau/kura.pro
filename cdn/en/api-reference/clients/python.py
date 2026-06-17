"""
CloudCDN API Client -- Python (requests).
Auto-generated from openapi.json -- do not edit manually.

Base URL: https://cloudcdn.pro

Usage:
    from python import CloudCDNClient

    with CloudCDNClient(access_key='sk_live_...') as client:
        summary = client.get_insights_summary(query={'days': 30})
        print(summary['totalRequests'])

Every method returns parsed JSON (dict / list) for ``application/json``
responses, or the raw ``requests.Response`` otherwise.
Non-2xx responses raise ``CloudCDNError`` carrying ``status``, ``body``,
and ``url``.
"""

from __future__ import annotations

from typing import Any, Optional, Union
import requests

BASE_URL = "https://cloudcdn.pro"


class CloudCDNError(Exception):
    """Raised for any non-2xx response from the CloudCDN API.

    Attributes:
        status: HTTP status code returned by the edge.
        body: The parsed JSON error body, or ``{'error': <statusText>}``.
        url: The full URL that was requested (for log scraping).
    """

    def __init__(self, message: str, *, status: int, body: Any, url: str) -> None:
        super().__init__(message)
        self.status = status
        self.body = body
        self.url = url


class CloudCDNClient:
    """Production-quality client for the CloudCDN REST API.

    Pass auth keys once at construction time; per-call inputs go in
    via ``query``, ``body``, ``timeout``, etc. Supports context-manager
    use so the underlying ``requests.Session`` is closed deterministically:

        with CloudCDNClient(access_key='sk_live_...') as client:
            data = client.list_assets(query={'project': 'akande'})
    """

    def __init__(
        self,
        base_url: str = BASE_URL,
        *,
        access_key: Optional[str] = None,
        account_key: Optional[str] = None,
        purge_key: Optional[str] = None,
        analytics_key: Optional[str] = None,
        bearer_token: Optional[str] = None,
        timeout: Optional[float] = 30.0,
        session: Optional[requests.Session] = None,
    ) -> None:
        """Construct a client.

        Args:
            base_url: API base URL. Defaults to production edge.
            access_key: Storage / Assets / Insights ``AccessKey`` header.
            account_key: Core / control-plane ``AccountKey`` header.
            purge_key: Cache purge ``x-api-key`` header.
            analytics_key: Analytics ``x-api-key`` header.
            bearer_token: Scoped token used as ``Authorization: Bearer …``.
            timeout: Default per-request timeout in seconds.
            session: Optional ``requests.Session`` for connection pooling.
        """
        self.base_url = base_url.rstrip('/')
        self.access_key = access_key or ''
        self.account_key = account_key or ''
        self.purge_key = purge_key or ''
        self.analytics_key = analytics_key or ''
        self.bearer_token = bearer_token or ''
        self.timeout = timeout
        self._session = session or requests.Session()
        self._owns_session = session is None

    def __enter__(self) -> 'CloudCDNClient':
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def close(self) -> None:
        """Close the underlying session if we created it."""
        if self._owns_session:
            self._session.close()

    def _auth_headers(self, scheme: Optional[str]) -> dict:
        if scheme == 'AccessKey' and self.access_key:
            return {'AccessKey': self.access_key}
        if scheme == 'AccountKey' and self.account_key:
            return {'AccountKey': self.account_key}
        if scheme == 'PurgeKey' and self.purge_key:
            return {'x-api-key': self.purge_key}
        if scheme == 'AnalyticsKey' and self.analytics_key:
            return {'x-api-key': self.analytics_key}
        if scheme == 'BearerToken' and self.bearer_token:
            return {'Authorization': f'Bearer {self.bearer_token}'}
        return {}

    def _request(
        self,
        method: str,
        path: str,
        *,
        scheme: Optional[str] = None,
        json_body: Any = None,
        data: Any = None,
        params: Optional[dict] = None,
        headers: Optional[dict] = None,
        stream: bool = False,
        raw: bool = False,
        timeout: Optional[float] = None,
    ) -> Any:
        """Send a request and return parsed JSON, or raw Response when ``raw``."""
        url = f'{self.base_url}{path}'
        merged = {**self._auth_headers(scheme), **(headers or {})}
        resp = self._session.request(
            method,
            url,
            headers=merged,
            json=json_body,
            data=data,
            params=params,
            stream=stream,
            timeout=timeout if timeout is not None else self.timeout,
        )
        if not resp.ok:
            try:
                body = resp.json()
            except Exception:  # noqa: BLE001 — body may be non-JSON
                body = {'error': resp.reason}
            msg = body.get('Message') or body.get('error') or f'{method} {path} -> HTTP {resp.status_code}'
            raise CloudCDNError(msg, status=resp.status_code, body=body, url=url)
        if raw:
            return resp
        ct = resp.headers.get('content-type', '')
        if 'application/json' in ct:
            return resp.json()
        return resp

    def alt_text_get(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Generate alt text (GET) -- [GET /api/ai/alt-text].

        Generate accessibility-quality alt text for an image using a Workers AI vision model (LLaVA). Result is cached for 24 hours per asset path; repeated requests cost zero neurons. When the daily Workers AI neuron budget is exhausted the endpoint returns 503 rather than a hallucinated answer.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/ai/alt-text', scheme='AccountKey', params=query, timeout=timeout)

    def alt_text_post(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Generate alt text (POST) -- [POST /api/ai/alt-text].

        Same as GET but accepts the asset URL in a JSON body — useful for clients that prefer POST semantics for AI calls.

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/ai/alt-text', scheme='AccountKey', json_body=body, timeout=timeout)

    def background_remove_get(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Remove image background (not yet implemented) -- [GET /api/ai/background-remove].

        Isolate the subject of an image on a transparent alpha layer. **This endpoint is documented but not yet implemented** — calls return HTTP 501. Cloudflare Workers AI does not currently include a segmentation/matting model (U^2-Net or rembg-class), so we cannot produce a pixel-accurate alpha mask at the edge.
        
        The route, request shape, and response envelope are fixed now so clients and agents can integrate ahead of the model landing; when Workers AI adds a segmentation primitive (or we ship one via Workers AI Custom Models), the implementation will swap in without changing this contract.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/ai/background-remove', scheme='AccountKey', params=query, timeout=timeout)

    def background_remove_post(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Remove image background (not yet implemented) -- [POST /api/ai/background-remove].

        Isolate the subject of an image on a transparent alpha layer. **This endpoint is documented but not yet implemented** — calls return HTTP 501. Cloudflare Workers AI does not currently include a segmentation/matting model (U^2-Net or rembg-class), so we cannot produce a pixel-accurate alpha mask at the edge.
        
        The route, request shape, and response envelope are fixed now so clients and agents can integrate ahead of the model landing; when Workers AI adds a segmentation primitive (or we ship one via Workers AI Custom Models), the implementation will swap in without changing this contract.

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/ai/background-remove', scheme='AccountKey', json_body=body, timeout=timeout)

    def chat_concierge(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> requests.Response:
        """AI Chat Concierge -- [POST /api/chat].

        RAG-powered conversational AI assistant for CloudCDN. Uses Workers AI (Llama 3.1 8B) with Vectorize for context retrieval. Returns a Server-Sent Events (SSE) stream with metadata, token, done, and error events. Rate limits: 1,000 queries/month, 100 queries/day (soft). Public endpoint (no auth). Last 5 conversation history turns are used for context.

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Raw ``requests.Response``.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/chat', json_body=body, stream=True, timeout=timeout)

    def health_check(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Service health and binding status -- [GET /api/health].

        Health probe for monitors and operators. By default returns a cheap binding-presence summary (no I/O). Pass `?deep=1` to actually exercise each binding: ASSETS via a manifest.json fetch, RATE_KV via a probe key read, plus shape checks for AI, VECTOR_INDEX, RATE_LIMITER, METRICS, WEBHOOK_QUEUE, and AUDIT_LOG_KV.
        
        HTTP status reflects health: 200 when ok, 503 when degraded. Required bindings (ASSETS, RATE_KV) degrade the service when missing or broken; optional bindings only degrade when configured-but-broken (so a deploy that hasn't enabled the AI surface stays 200 ok).

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/health', params=query, timeout=timeout)

    def moderate_get(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """AI image moderation (GET) -- [GET /api/ai/moderate].

        Classify an image across five safety categories (nudity, violence, drugs, hate symbols, gore) using a Workers AI vision model. Returns a verdict (`safe`|`borderline`|`unsafe`) plus per-category 0-1 scores. On unparseable model output the endpoint conservatively returns `borderline` so automated gates still have to decide. Cached 24 hours per asset.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/ai/moderate', scheme='AccountKey', params=query, timeout=timeout)

    def moderate_post(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """AI image moderation (POST) -- [POST /api/ai/moderate].

        Same as GET but accepts the asset URL in a JSON body.

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/ai/moderate', scheme='AccountKey', json_body=body, timeout=timeout)

    def search_assets(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Semantic asset search -- [GET /api/search].

        Searches assets using vector similarity (Vectorize + Workers AI embeddings) with automatic fallback to token-scored fuzzy matching against the manifest. Public endpoint (no auth). Results cached for 60 seconds. Vector search threshold: score > 0.5.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/search', params=query, timeout=timeout)

    def smart_crop_get(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """AI smart-crop gravity (GET) -- [GET /api/ai/smart-crop].

        Identify the subject of an image and return a `gravity` value compatible with `/api/transform?gravity=`. Output is one of nine compass directions plus `face` and `center`, with a confidence band (`high|medium|low`). Cached 24 hours per asset path. Chain with the transform endpoint to produce subject-aware thumbnails.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/ai/smart-crop', scheme='AccountKey', params=query, timeout=timeout)

    def smart_crop_post(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """AI smart-crop gravity (POST) -- [POST /api/ai/smart-crop].

        Same as GET but accepts the asset URL in a JSON body.

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/ai/smart-crop', scheme='AccountKey', json_body=body, timeout=timeout)

    def get_asset_metadata(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Get asset metadata -- [GET /api/assets/metadata].

        Returns detailed metadata for a single asset including available format variants, CDN URL, and transform URL.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/assets/metadata', scheme='AccessKey', params=query, timeout=timeout)

    def list_assets(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """List assets -- [GET /api/assets].

        Paginated, filterable asset catalog. Streams JSON for sub-2ms TTFB. Supports filtering by project, category, format, and free-text search. Rate limit: none (public with AccessKey).

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/assets', scheme='AccessKey', params=query, timeout=timeout)

    def create_token(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Create a scoped API token -- [POST /api/tokens].

        Mints a new API token with the given scopes. The plaintext token is returned **once** in the response — store it; it cannot be retrieved again. SHA-256 hashed at rest.

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/tokens', scheme='AccountKey', json_body=body, timeout=timeout)

    def list_passkeys(self, *, timeout: Optional[float] = None) -> Any:
        """List registered passkeys -- [GET /api/passkeys].

        Returns metadata for every registered passkey for the authenticated user. Credential IDs are exposed; the raw public keys are not.


        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/passkeys', scheme='SessionCookie', timeout=timeout)

    def list_tokens(self, *, timeout: Optional[float] = None) -> Any:
        """List API tokens (redacted) -- [GET /api/tokens].

        Returns all tokens for the account. Full token values are never exposed — only the prefix, scopes, and timestamps.


        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/tokens', scheme='AccountKey', timeout=timeout)

    def passkey_auth_begin(self, *, timeout: Optional[float] = None) -> Any:
        """Start passkey authentication — get a challenge -- [POST /api/passkeys/auth/begin].

        Returns a WebAuthn `PublicKeyCredentialRequestOptions` payload. Public endpoint (no session required).


        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/passkeys/auth/begin', timeout=timeout)

    def passkey_auth_complete(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Complete passkey authentication -- [POST /api/passkeys/auth/complete].

        Verifies the assertion. On success, sets the `cdn_session` cookie (HMAC-signed, HttpOnly, Secure, 7-day TTL).

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/passkeys/auth/complete', json_body=body, timeout=timeout)

    def passkey_register_begin(self, *, timeout: Optional[float] = None) -> Any:
        """Start passkey registration — get a challenge -- [POST /api/passkeys/register/begin].

        Returns a WebAuthn `PublicKeyCredentialCreationOptions` payload. Pass the resulting credential to `/api/passkeys/register/complete`.


        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/passkeys/register/begin', scheme='SessionCookie', timeout=timeout)

    def passkey_register_complete(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Complete passkey registration -- [POST /api/passkeys/register/complete].

        Verifies the WebAuthn attestation, stores the credential, and returns the persisted passkey metadata.

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/passkeys/register/complete', scheme='SessionCookie', json_body=body, timeout=timeout)

    def revoke_passkey(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Revoke a passkey -- [DELETE /api/passkeys].

        Permanently revokes a passkey by ID. The credential is removed from KV; subsequent authentication attempts with it fail.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('DELETE', f'/api/passkeys', scheme='SessionCookie', params=query, timeout=timeout)

    def revoke_token(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Revoke an API token -- [DELETE /api/tokens].

        Permanently revokes the token by ID. Subsequent requests using this token return 401.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('DELETE', f'/api/tokens', scheme='AccountKey', params=query, timeout=timeout)

    def add_domain(self, id: str, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Add custom domain to zone -- [POST /api/core/zones/{id}/domains].

        Adds a custom domain to a zone via the Cloudflare Pages API. SSL certificate is provisioned automatically. Requires CNAME pointed to cloudcdn-pro.pages.dev.

        Args:
            id: Zone identifier
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/core/zones/{id}/domains', scheme='AccountKey', json_body=body, timeout=timeout)

    def audit_logs(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Audit log reader -- [GET /api/core/audit-logs].

        Read the persistent control-plane audit trail. Each entry carries timestamp, action, client IP, user agent, request trace ID, and action-specific metadata. AccountKey-gated. 90-day retention.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/core/audit-logs', scheme='AccountKey', params=query, timeout=timeout)

    def create_zone(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Create a new zone -- [POST /api/core/zones].

        Creates a new tenant zone via Git commit. Scaffolds standard v1/ directories: banners, github, icons, logos, titles. Zone name must be 2-64 lowercase alphanumeric characters with hyphens.

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/core/zones', scheme='AccountKey', json_body=body, timeout=timeout)

    def delete_zone(self, id: str, *, timeout: Optional[float] = None) -> Any:
        """Delete zone -- [DELETE /api/core/zones/{id}].

        Deletes an entire zone and all its files via a single Git commit. Triggers async cache purge by project tag.

        Args:
            id: Zone identifier to delete
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('DELETE', f'/api/core/zones/{id}', scheme='AccountKey', timeout=timeout)

    def get_rules(self, *, timeout: Optional[float] = None) -> Any:
        """Read edge rules -- [GET /api/core/rules].

        Returns the current contents of _headers and _redirects edge rule files.


        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/core/rules', scheme='AccountKey', timeout=timeout)

    def get_statistics(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Get edge statistics -- [GET /api/core/statistics].

        Returns bandwidth, requests, cache ratios, geographic distribution, and top assets from the analytics KV store. Optionally filtered by zone. Data retained for up to 90 days.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/core/statistics', scheme='AccountKey', params=query, timeout=timeout)

    def get_zone(self, id: str, *, timeout: Optional[float] = None) -> Any:
        """Get zone details -- [GET /api/core/zones/{id}].

        Returns detailed information about a zone including all files, categories, formats, and storage usage.

        Args:
            id: Zone identifier (project name)
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/core/zones/{id}', scheme='AccountKey', timeout=timeout)

    def list_zones(self, *, timeout: Optional[float] = None) -> Any:
        """List all zones -- [GET /api/core/zones].

        Returns all tenant zones derived from the asset manifest. Each zone represents a client project with its file count, storage usage, and categories.


        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/core/zones', scheme='AccountKey', timeout=timeout)

    def update_rules(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Update edge rules -- [POST /api/core/rules].

        Updates _headers or _redirects via a Git commit. Content max size: 100 KB. Changes take effect after CI/CD deploy (~60-90 seconds).

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/core/rules', scheme='AccountKey', json_body=body, timeout=timeout)

    def auto_format(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> requests.Response:
        """Automatic format negotiation -- [GET /api/auto].

        Serves the best image format based on the client's Accept header. Still-image fallback chain (preference order): JXL -> AVIF -> HEIF/HEIC -> WebP -> PNG -> SVG. Animated variant available via `?anim=1`: animated AVIF (.avifs) -> animated WebP -> APNG -> GIF. JXL/AVIF/HEIF/HEIC and animated formats require explicit Accept opt-in; WebP, PNG, SVG, and GIF are universal fallbacks. Public endpoint (no auth). Also supports path-based routing: `/api/auto/{path}`. Responses cached for 1 year with Vary: Accept, Save-Data, Sec-CH-Effective-Connection-Type.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Raw ``requests.Response``.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/auto', params=query, raw=True, timeout=timeout)

    def auto_format_path(self, path: str, *, timeout: Optional[float] = None) -> Any:
        """Path-based automatic format negotiation -- [GET /api/auto/{path}].

        Catch-all route for path-based format negotiation. Delegates to the main auto handler by rewriting the URL path segments into a query parameter. Serves the best image format based on the client's Accept header. Fallback chain: avif -> webp -> png -> svg. Public endpoint (no auth). Responses cached for 1 year with Vary: Accept.

        Args:
            path: Asset path without file extension (e.g., bankingonai/images/logos/logo). Supports multiple path segments via catch-all routing.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/auto/{path}', timeout=timeout)

    def blurhash(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Content-addressable placeholder hash -- [GET /api/blurhash].

        Companion to `/api/lqip` returning both a 40-char SHA-256 content hash and a base64 data URI. Use the hash to dedupe placeholder caches by content. Same source pipeline as LQIP; cached 24 h per (url, size).

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/blurhash', params=query, timeout=timeout)

    def lqip(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Low-quality image placeholder -- [GET /api/lqip].

        Generate a base64 data URI for a tiny blurred WebP placeholder. Use as `<img src>` or CSS `background-image` while the full asset loads. Result is deterministic per (url, size, blur) and cached for 24 hours. No Workers AI cost — uses Cloudflare Image Resizing directly.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/lqip', params=query, timeout=timeout)

    def pipeline_ingest(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Scaffold a zone or stock asset from a single SVG -- [POST /api/pipeline].

        Single-SVG ingest. Generates the full directory tree (logos, banners, icons, favicon, PWA manifest) and commits it via the GitHub API. Two modes: `client` creates a new tenant zone; `stock` adds to the shared stock pool.

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/pipeline', scheme='AccountKey', json_body=body, timeout=timeout)

    def purge_cache(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Purge CDN cache -- [POST /api/purge].

        Invalidates cached content via the Cloudflare API. Supports three modes (exactly one per request): specific URLs (max 30), cache tags (max 30), or purge everything. Rate limit: 100 purge requests per day. Auth: x-api-key header (PURGE_KEY).

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/purge', scheme='PurgeKey', json_body=body, timeout=timeout)

    def stream_video(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> requests.Response:
        """HLS video streaming -- [GET /api/stream].

        Pseudo-HLS streaming endpoint. Without quality parameter, returns a master M3U8 playlist. With quality, returns a variant playlist. With quality and segment, returns a byte-range video segment. Public endpoint (no auth). Available videos: black, mount_fuji, nature. Available qualities: 1080, 720, 480. Segment duration: 10 seconds. Segments cached for 1 year.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Raw ``requests.Response``.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/stream', params=query, raw=True, timeout=timeout)

    def transform_image(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> requests.Response:
        """Transform image -- [GET /api/transform].

        On-the-fly image transformation via Cloudflare Image Resizing. Supports resize, crop, format conversion, blur, and sharpen. Public endpoint (no auth required). Rate limit: 50,000 transforms per calendar month. Responses are cached for 1 year with immutable directive.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Raw ``requests.Response``.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/transform', params=query, raw=True, timeout=timeout)

    def verify_signed_url(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> requests.Response:
        """Verify signed URL -- [GET /api/signed].

        Validates an HMAC-SHA256 signed URL, checks expiration, and proxies the protected asset from origin. Uses constant-time comparison to prevent timing attacks. Responses cached privately for 1 hour. Public endpoint (signature is the auth).

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Raw ``requests.Response``.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/signed', params=query, raw=True, timeout=timeout)

    def get_analytics(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Get analytics report -- [GET /api/analytics].

        Returns daily analytics data including hits, bandwidth, top assets, geographic distribution, and cache ratios. Auth: x-api-key header (ANALYTICS_KEY). Data retained for 35 days in KV.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/analytics', scheme='AnalyticsKey', params=query, timeout=timeout)

    def get_errors(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Error tracking -- [GET /api/insights/errors].

        Returns 4xx/5xx error counts grouped by status code with the top 10 paths per code. Error data populates automatically from middleware analytics. Accepts either AccountKey or AccessKey.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/insights/errors', scheme='AccountKey', params=query, timeout=timeout)

    def get_geography(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Geographic distribution -- [GET /api/insights/geography].

        Returns request counts by country (ISO 3166-1 alpha-2 codes), sorted descending by volume. Accepts either AccountKey or AccessKey.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/insights/geography', scheme='AccountKey', params=query, timeout=timeout)

    def get_insights_summary(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Analytics summary -- [GET /api/insights/summary].

        Aggregate analytics summary: total requests, bandwidth, cache hit rate, and unique countries. Accepts either AccountKey or AccessKey for authentication.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/insights/summary', scheme='AccountKey', params=query, timeout=timeout)

    def get_top_assets(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Top requested assets -- [GET /api/insights/top-assets].

        Returns the most-requested assets over the specified period, ranked by request count. Accepts either AccountKey or AccessKey.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/insights/top-assets', scheme='AccountKey', params=query, timeout=timeout)

    def insights_asset(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Per-asset analytics -- [GET /api/insights/asset].

        Return daily request counts and error roll-ups for a single asset path. Useful for dashboards that need 'how is THIS asset performing' — rolled-up totals come from the existing `/api/insights/summary`. Path matching tolerates leading-slash differences.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/insights/asset', scheme='AccountKey', params=query, timeout=timeout)

    def track_analytics(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Record analytics hit -- [POST /api/analytics].

        Programmatic endpoint for recording a request hit. Called by the trackRequest middleware helper. Increments daily counters for hits, bandwidth, top assets, geo, and cache status. Public endpoint (no auth) -- intended for internal use by edge middleware.

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/analytics', json_body=body, timeout=timeout)

    def get_logs(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Stream or fetch operational logs -- [GET /api/logs].

        Returns the worker request log buffered in KV. Use `?stream=1` for SSE; otherwise a JSON page is returned. Useful for live debugging and post-incident analysis.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/logs', scheme='AccountKey', params=query, timeout=timeout)

    def storage_batch_upload(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Batch upload files -- [POST /api/storage/batch].

        Uploads multiple files in a single Git commit using the GitHub Git Database API (Trees + Commits). Avoids 409 conflicts from concurrent Contents API calls. Max 50 files per batch, 25 MB per file.

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/storage/batch', scheme='AccessKey', json_body=body, timeout=timeout)

    def storage_delete(self, path: str, *, timeout: Optional[float] = None) -> Any:
        """Delete file -- [DELETE /api/storage/{path}].

        Deletes a file from storage via GitHub API commit. Triggers async cache purge.

        Args:
            path: File path to delete
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('DELETE', f'/api/storage/{path}', scheme='AccessKey', timeout=timeout)

    def storage_get_or_list(self, path: str, *, timeout: Optional[float] = None) -> Any:
        """List directory or download file -- [GET /api/storage/{path}].

        If the path ends with `/` or has no file extension, lists directory contents in Bunny.net-compatible JSON. Otherwise, downloads the file. Auth: AccessKey header or dashboard session cookie.

        Args:
            path: Storage path. Trailing slash = directory listing. File extension = download.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/storage/{path}', scheme='AccessKey', timeout=timeout)

    def storage_head(self, path: str, *, timeout: Optional[float] = None) -> requests.Response:
        """File metadata (HEAD) -- [HEAD /api/storage/{path}].

        Returns Content-Length and Content-Type headers for a file without downloading the body.

        Args:
            path: File path
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Raw ``requests.Response``.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('HEAD', f'/api/storage/{path}', scheme='AccessKey', raw=True, timeout=timeout)

    def storage_upload(self, path: str, *, data: Optional[Union[bytes, bytearray]] = None, timeout: Optional[float] = None) -> Any:
        """Upload file -- [PUT /api/storage/{path}].

        Uploads a file to storage via GitHub API commit. Max file size: 25 MB. Supports optional SHA-256 checksum verification via the Checksum header. Triggers async cache purge on overwrites. Rate limit: none (auth-gated).

        Args:
            path: Destination file path
            data: Raw request body bytes.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('PUT', f'/api/storage/{path}', scheme='AccessKey', data=data, timeout=timeout)

    def delete_webhook(self, *, query: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Delete a webhook -- [DELETE /api/webhooks].

        Permanently removes a webhook by ID. Future deliveries for the subscribed events stop immediately.

        Args:
            query: Query parameters.
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('DELETE', f'/api/webhooks', scheme='AccountKey', params=query, timeout=timeout)

    def list_webhooks(self, *, timeout: Optional[float] = None) -> Any:
        """List registered webhooks -- [GET /api/webhooks].

        Returns metadata for every webhook registered against the account: id, target URL, subscribed events, creation timestamp, and active flag.


        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('GET', f'/api/webhooks', scheme='AccountKey', timeout=timeout)

    def register_webhook(self, *, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        """Register a webhook -- [POST /api/webhooks].

        Subscribes the given URL to one or more event types. Deliveries are signed (HMAC-SHA256) and fan-out via a Cloudflare Queue + DLQ for at-least-once semantics. Failed deliveries are retried with exponential backoff.

        Args:
            body: Request body (JSON-serialised).
            timeout: Per-call timeout in seconds (overrides the client default).

        Returns: Parsed JSON or raw ``requests.Response`` for non-JSON.

        Raises:
            CloudCDNError: For any non-2xx response.
        """
        return self._request('POST', f'/api/webhooks', scheme='AccountKey', json_body=body, timeout=timeout)
