"""
CloudCDN API Client -- Python (requests)
Auto-generated from openapi.json -- do not edit manually

Base URL: https://cloudcdn.pro
"""

import requests
from typing import Any, Optional

BASE_URL = "https://cloudcdn.pro"


def _request(
    method: str,
    path: str,
    *,
    headers: Optional[dict] = None,
    json_body: Any = None,
    data: Any = None,
    params: Optional[dict] = None,
    stream: bool = False,
) -> requests.Response:
    """Send an HTTP request and return the Response."""
    url = f"{BASE_URL}{path}"
    resp = requests.request(
        method,
        url,
        headers=headers or {},
        json=json_body,
        data=data,
        params=params,
        stream=stream,
    )
    resp.raise_for_status()
    return resp


def listAssets(params: Optional[dict] = None, api_key: str = "") -> requests.Response:
    """List assets [GET /api/assets]"""
    path = "/api/assets"
    headers = {"AccessKey": api_key}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def getAssetMetadata(params: Optional[dict] = None, api_key: str = "") -> requests.Response:
    """Get asset metadata [GET /api/assets/metadata]"""
    path = "/api/assets/metadata"
    headers = {"AccessKey": api_key}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def storageGetOrList(path: str, api_key: str = "") -> requests.Response:
    """List directory or download file [GET /api/storage/{path}]"""
    path = f"/api/storage/{path}"
    headers = {"AccessKey": api_key}
    method = "GET"
    return _request(method, path, headers=headers)


def storageUpload(path: str, data: bytes, api_key: str = "") -> requests.Response:
    """Upload file [PUT /api/storage/{path}]"""
    path = f"/api/storage/{path}"
    headers = {"AccessKey": api_key}
    headers["Content-Type"] = "application/octet-stream"
    method = "PUT"
    return _request(method, path, headers=headers, data=data)


def storageDelete(path: str, api_key: str = "") -> requests.Response:
    """Delete file [DELETE /api/storage/{path}]"""
    path = f"/api/storage/{path}"
    headers = {"AccessKey": api_key}
    method = "DELETE"
    return _request(method, path, headers=headers)


def storageHead(path: str, api_key: str = "") -> requests.Response:
    """File metadata (HEAD) [HEAD /api/storage/{path}]"""
    path = f"/api/storage/{path}"
    headers = {"AccessKey": api_key}
    method = "HEAD"
    return _request(method, path, headers=headers)


def storageBatchUpload(body: dict, api_key: str = "") -> requests.Response:
    """Batch upload files [POST /api/storage/batch]"""
    path = "/api/storage/batch"
    headers = {"AccessKey": api_key}
    method = "POST"
    return _request(method, path, headers=headers, json_body=body)


def listZones(api_key: str = "") -> requests.Response:
    """List all zones [GET /api/core/zones]"""
    path = "/api/core/zones"
    headers = {"AccountKey": api_key}
    method = "GET"
    return _request(method, path, headers=headers)


def createZone(body: dict, api_key: str = "") -> requests.Response:
    """Create a new zone [POST /api/core/zones]"""
    path = "/api/core/zones"
    headers = {"AccountKey": api_key}
    method = "POST"
    return _request(method, path, headers=headers, json_body=body)


def getZone(id: str, api_key: str = "") -> requests.Response:
    """Get zone details [GET /api/core/zones/{id}]"""
    path = f"/api/core/zones/{id}"
    headers = {"AccountKey": api_key}
    method = "GET"
    return _request(method, path, headers=headers)


def deleteZone(id: str, api_key: str = "") -> requests.Response:
    """Delete zone [DELETE /api/core/zones/{id}]"""
    path = f"/api/core/zones/{id}"
    headers = {"AccountKey": api_key}
    method = "DELETE"
    return _request(method, path, headers=headers)


def addDomain(id: str, body: dict, api_key: str = "") -> requests.Response:
    """Add custom domain to zone [POST /api/core/zones/{id}/domains]"""
    path = f"/api/core/zones/{id}/domains"
    headers = {"AccountKey": api_key}
    method = "POST"
    return _request(method, path, headers=headers, json_body=body)


def getStatistics(params: Optional[dict] = None, api_key: str = "") -> requests.Response:
    """Get edge statistics [GET /api/core/statistics]"""
    path = "/api/core/statistics"
    headers = {"AccountKey": api_key}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def getRules(api_key: str = "") -> requests.Response:
    """Read edge rules [GET /api/core/rules]"""
    path = "/api/core/rules"
    headers = {"AccountKey": api_key}
    method = "GET"
    return _request(method, path, headers=headers)


def updateRules(body: dict, api_key: str = "") -> requests.Response:
    """Update edge rules [POST /api/core/rules]"""
    path = "/api/core/rules"
    headers = {"AccountKey": api_key}
    method = "POST"
    return _request(method, path, headers=headers, json_body=body)


def getInsightsSummary(params: Optional[dict] = None, api_key: str = "") -> requests.Response:
    """Analytics summary [GET /api/insights/summary]"""
    path = "/api/insights/summary"
    headers = {"AccountKey": api_key}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def getTopAssets(params: Optional[dict] = None, api_key: str = "") -> requests.Response:
    """Top requested assets [GET /api/insights/top-assets]"""
    path = "/api/insights/top-assets"
    headers = {"AccountKey": api_key}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def getGeography(params: Optional[dict] = None, api_key: str = "") -> requests.Response:
    """Geographic distribution [GET /api/insights/geography]"""
    path = "/api/insights/geography"
    headers = {"AccountKey": api_key}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def getErrors(params: Optional[dict] = None, api_key: str = "") -> requests.Response:
    """Error tracking [GET /api/insights/errors]"""
    path = "/api/insights/errors"
    headers = {"AccountKey": api_key}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def transformImage(params: Optional[dict] = None) -> requests.Response:
    """Transform image [GET /api/transform]"""
    path = "/api/transform"
    headers = {}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def autoFormat(params: Optional[dict] = None) -> requests.Response:
    """Automatic format negotiation [GET /api/auto]"""
    path = "/api/auto"
    headers = {}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def verifySignedUrl(params: Optional[dict] = None) -> requests.Response:
    """Verify signed URL [GET /api/signed]"""
    path = "/api/signed"
    headers = {}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def streamVideo(params: Optional[dict] = None) -> requests.Response:
    """HLS video streaming [GET /api/stream]"""
    path = "/api/stream"
    headers = {}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def purgeCache(body: dict, api_key: str = "") -> requests.Response:
    """Purge CDN cache [POST /api/purge]"""
    path = "/api/purge"
    headers = {"x-api-key": api_key}
    method = "POST"
    return _request(method, path, headers=headers, json_body=body)


def getAnalytics(params: Optional[dict] = None, api_key: str = "") -> requests.Response:
    """Get analytics report [GET /api/analytics]"""
    path = "/api/analytics"
    headers = {"x-api-key": api_key}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def trackAnalytics(body: dict) -> requests.Response:
    """Record analytics hit [POST /api/analytics]"""
    path = "/api/analytics"
    headers = {}
    method = "POST"
    return _request(method, path, headers=headers, json_body=body)


def searchAssets(params: Optional[dict] = None) -> requests.Response:
    """Semantic asset search [GET /api/search]"""
    path = "/api/search"
    headers = {}
    method = "GET"
    return _request(method, path, headers=headers, params=params)


def chatConcierge(body: dict) -> requests.Response:
    """AI Chat Concierge [POST /api/chat]"""
    path = "/api/chat"
    headers = {}
    method = "POST"
    return _request(method, path, headers=headers, json_body=body, stream=True)

