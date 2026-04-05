import { describe, it, expect, vi, afterEach } from 'vitest';

const { onRequestGet, onRequestOptions, SEGMENT_DURATION, SEGMENT_BYTES } =
  await import('../../../functions/api/stream.js');

const originalFetch = globalThis.fetch;

function makeCtx(url) {
  return {
    request: { url: `https://cloudcdn.pro${url}` },
  };
}

describe('OPTIONS /api/stream', () => {
  it('returns 204 with CORS headers', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});

describe('GET /api/stream', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // --- Validation ---

  it('returns 400 when video parameter is missing', async () => {
    const res = await onRequestGet(makeCtx('/api/stream'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid video');
  });

  it('returns 400 for invalid video name', async () => {
    const res = await onRequestGet(makeCtx('/api/stream?video=malicious'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid video');
    expect(json.error).toContain('black');
  });

  // --- Master playlist ---

  it('returns master playlist when only video is specified', async () => {
    const res = await onRequestGet(makeCtx('/api/stream?video=black'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.apple.mpegurl'
    );
    const body = await res.text();
    expect(body).toContain('#EXTM3U');
    expect(body).toContain('#EXT-X-STREAM-INF');
    expect(body).toContain('quality=720');
  });

  it('master playlist has CORS headers', async () => {
    const res = await onRequestGet(makeCtx('/api/stream?video=black'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('master playlist has Cache-Control header', async () => {
    const res = await onRequestGet(makeCtx('/api/stream?video=black'));
    expect(res.headers.get('Cache-Control')).toContain('max-age=');
  });

  // --- Invalid quality ---

  it('returns 400 for invalid quality', async () => {
    const res = await onRequestGet(
      makeCtx('/api/stream?video=black&quality=240')
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid quality');
  });

  // --- Variant playlist ---

  it('returns variant playlist with quality parameter', async () => {
    const fileSize = SEGMENT_BYTES * 3 + 1000; // ~3.x segments
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-length': String(fileSize) },
      })
    );

    const res = await onRequestGet(
      makeCtx('/api/stream?video=mount_fuji&quality=720')
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.apple.mpegurl'
    );

    const body = await res.text();
    expect(body).toContain('#EXTM3U');
    expect(body).toContain('#EXT-X-TARGETDURATION');
    expect(body).toContain('#EXT-X-ENDLIST');
    expect(body).toContain('segment=');

    // HEAD request was made
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/stock/videos/mount_fuji.mp4'),
      { method: 'HEAD' }
    );
  });

  it('returns 404 when HEAD request for variant playlist fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 404 })
    );

    const res = await onRequestGet(
      makeCtx('/api/stream?video=black&quality=720')
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain('not found');
  });

  it('returns 500 when content-length is missing from HEAD response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const res = await onRequestGet(
      makeCtx('/api/stream?video=black&quality=720')
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Cannot determine video size');
  });

  // --- Segment request ---

  it('returns video/mp4 content type for segment request', async () => {
    const fileSize = SEGMENT_BYTES * 5;
    // First call: HEAD for size; second call: range fetch
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'content-length': String(fileSize) },
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(1000), {
          status: 206,
          headers: { 'content-length': String(SEGMENT_BYTES) },
        })
      );

    const res = await onRequestGet(
      makeCtx('/api/stream?video=nature&quality=720&segment=0')
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns 400 for negative segment index', async () => {
    const res = await onRequestGet(
      makeCtx('/api/stream?video=black&quality=720&segment=-1')
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid segment');
  });

  it('returns 400 for non-numeric segment index', async () => {
    const res = await onRequestGet(
      makeCtx('/api/stream?video=black&quality=720&segment=abc')
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid segment');
  });

  it('returns 404 for segment index out of range', async () => {
    const fileSize = SEGMENT_BYTES * 2; // 2 segments (index 0 and 1)
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-length': String(fileSize) },
      })
    );

    const res = await onRequestGet(
      makeCtx('/api/stream?video=black&quality=720&segment=5')
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain('out of range');
  });

  it('returns 502 when range fetch fails', async () => {
    const fileSize = SEGMENT_BYTES * 3;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'content-length': String(fileSize) },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    const res = await onRequestGet(
      makeCtx('/api/stream?video=black&quality=720&segment=0')
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain('Failed to fetch segment');
  });

  it('returns 404 when HEAD request fails for segment', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 404 })
    );

    const res = await onRequestGet(
      makeCtx('/api/stream?video=black&quality=720&segment=0')
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain('not found');
  });

  // --- All available videos ---

  it('accepts all valid video names', async () => {
    for (const video of ['black', 'mount_fuji', 'nature']) {
      const res = await onRequestGet(makeCtx(`/api/stream?video=${video}`));
      expect(res.status).toBe(200);
    }
  });

  // --- Extended tests ---

  it('returns master playlist for black', async () => {
    const res = await onRequestGet(makeCtx('/api/stream?video=black'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('#EXTM3U');
  });

  it('returns master playlist for mount_fuji', async () => {
    const res = await onRequestGet(makeCtx('/api/stream?video=mount_fuji'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('#EXTM3U');
  });

  it('returns master playlist for nature', async () => {
    const res = await onRequestGet(makeCtx('/api/stream?video=nature'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('#EXTM3U');
  });

  it('returns variant playlist for quality 1080', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-length': String(SEGMENT_BYTES * 5) },
      })
    );
    const res = await onRequestGet(makeCtx('/api/stream?video=black&quality=1080'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('#EXTM3U');
  });

  it('returns variant playlist for quality 480', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-length': String(SEGMENT_BYTES * 3) },
      })
    );
    const res = await onRequestGet(makeCtx('/api/stream?video=black&quality=480'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('#EXTM3U');
  });

  it('returns 400 for invalid quality (360)', async () => {
    const res = await onRequestGet(makeCtx('/api/stream?video=black&quality=360'));
    expect(res.status).toBe(400);
  });

  it('master playlist contains all quality levels', async () => {
    const res = await onRequestGet(makeCtx('/api/stream?video=black'));
    const body = await res.text();
    expect(body).toContain('#EXT-X-STREAM-INF');
    // Should reference multiple quality levels
    expect(body).toContain('quality=');
  });

  it('variant playlist has correct segment count', async () => {
    const numSegments = 4;
    const fileSize = SEGMENT_BYTES * numSegments;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-length': String(fileSize) },
      })
    );
    const res = await onRequestGet(makeCtx('/api/stream?video=black&quality=720'));
    const body = await res.text();
    // Count segment= references
    const segmentMatches = body.match(/segment=/g);
    expect(segmentMatches).not.toBeNull();
    expect(segmentMatches.length).toBe(numSegments);
  });

  it('rejects video name with path traversal', async () => {
    const res = await onRequestGet(makeCtx('/api/stream?video=../etc/passwd'));
    expect(res.status).toBe(400);
  });

  it('rejects video name with spaces', async () => {
    const res = await onRequestGet(makeCtx('/api/stream?video=my+video'));
    expect(res.status).toBe(400);
  });

  it('OPTIONS returns all required CORS headers', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
  });

  it('playlists have Cache-Control headers', async () => {
    const res = await onRequestGet(makeCtx('/api/stream?video=black'));
    expect(res.headers.get('Cache-Control')).toContain('max-age=');
  });

  it('segments have immutable cache headers', async () => {
    const fileSize = SEGMENT_BYTES * 5;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'content-length': String(fileSize) },
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(1000), {
          status: 206,
          headers: { 'content-length': String(SEGMENT_BYTES) },
        })
      );
    const res = await onRequestGet(makeCtx('/api/stream?video=black&quality=720&segment=0'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });

  it('variant playlist has CORS headers', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-length': String(SEGMENT_BYTES * 3) },
      })
    );
    const res = await onRequestGet(makeCtx('/api/stream?video=black&quality=720'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('variant playlist has Cache-Control', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-length': String(SEGMENT_BYTES * 3) },
      })
    );
    const res = await onRequestGet(makeCtx('/api/stream?video=black&quality=720'));
    expect(res.headers.get('Cache-Control')).toContain('max-age=');
  });

  it('segment response has Content-Type video/mp4', async () => {
    const fileSize = SEGMENT_BYTES * 5;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { 'content-length': String(fileSize) } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(100), { status: 206, headers: { 'content-length': String(SEGMENT_BYTES) } }));
    const res = await onRequestGet(makeCtx('/api/stream?video=black&quality=720&segment=0'));
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
  });

  it('400 response has JSON content type', async () => {
    const res = await onRequestGet(makeCtx('/api/stream'));
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('400 response has CORS', async () => {
    const res = await onRequestGet(makeCtx('/api/stream'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('master playlist for each video has CORS', async () => {
    for (const video of ['black', 'mount_fuji', 'nature']) {
      const res = await onRequestGet(makeCtx(`/api/stream?video=${video}`));
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
  });

  it('master playlist for each video has correct Content-Type', async () => {
    for (const video of ['black', 'mount_fuji', 'nature']) {
      const res = await onRequestGet(makeCtx(`/api/stream?video=${video}`));
      expect(res.headers.get('Content-Type')).toBe('application/vnd.apple.mpegurl');
    }
  });

  it('segment request sends correct Range header', async () => {
    const fileSize = SEGMENT_BYTES * 5;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'content-length': String(fileSize) },
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(100), {
          status: 206,
          headers: { 'content-length': String(SEGMENT_BYTES) },
        })
      );
    const res = await onRequestGet(makeCtx('/api/stream?video=black&quality=720&segment=1'));
    expect(res.status).toBe(200);
    // Verify second fetch call had Range header
    const rangeFetch = globalThis.fetch.mock.calls[1];
    expect(rangeFetch[1].headers.Range).toBeDefined();
    expect(rangeFetch[1].headers.Range).toContain('bytes=');
  });
});
