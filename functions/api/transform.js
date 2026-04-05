const MONTHLY_LIMIT = 50000;

const VALID_FIT = new Set(['cover', 'contain', 'fill', 'inside', 'outside']);
const VALID_FORMAT = new Set(['auto', 'webp', 'avif', 'png', 'jpeg']);
const VALID_GRAVITY = new Set([
  'center', 'north', 'south', 'east', 'west',
  'northeast', 'northwest', 'southeast', 'southwest',
  'face', 'auto',
]);

function clamp(val, min, max) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return undefined;
  return Math.max(min, Math.min(max, n));
}

export async function onRequestGet(context) {
  const { RATE_KV } = context.env;
  const url = new URL(context.request.url);
  const params = url.searchParams;

  // --- Rate limiting ---
  if (RATE_KV) {
    const now = new Date();
    const monthKey = `transforms:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    let monthCount = 0;
    try {
      monthCount = parseInt(await RATE_KV.get(monthKey)) || 0;
    } catch {}

    if (monthCount >= MONTHLY_LIMIT) {
      return Response.json(
        { error: 'limit_reached', message: 'Monthly transform limit reached.' },
        { status: 429 }
      );
    }

    try {
      await RATE_KV.put(monthKey, String(monthCount + 1), { expirationTtl: 86400 * 35 });
    } catch {}
  }

  // --- Validate required param ---
  const assetUrl = params.get('url');
  if (!assetUrl) {
    return Response.json(
      { error: 'Missing required parameter: url' },
      { status: 400 }
    );
  }

  // --- Build image options ---
  const imageOpts = {};

  const w = params.get('w');
  if (w !== null) {
    const val = clamp(w, 1, 8192);
    if (val === undefined) {
      return Response.json({ error: 'Invalid parameter: w must be 1-8192' }, { status: 400 });
    }
    imageOpts.width = val;
  }

  const h = params.get('h');
  if (h !== null) {
    const val = clamp(h, 1, 8192);
    if (val === undefined) {
      return Response.json({ error: 'Invalid parameter: h must be 1-8192' }, { status: 400 });
    }
    imageOpts.height = val;
  }

  const fit = params.get('fit');
  if (fit !== null) {
    if (!VALID_FIT.has(fit)) {
      return Response.json({ error: `Invalid parameter: fit must be one of ${[...VALID_FIT].join(', ')}` }, { status: 400 });
    }
    imageOpts.fit = fit;
  }

  const format = params.get('format');
  if (format !== null && format !== 'auto') {
    if (!VALID_FORMAT.has(format)) {
      return Response.json({ error: `Invalid parameter: format must be one of ${[...VALID_FORMAT].join(', ')}` }, { status: 400 });
    }
    imageOpts.format = format;
  }
  // format=auto: omit format to let Cloudflare negotiate via Accept header

  const q = params.get('q');
  if (q !== null) {
    const val = clamp(q, 1, 100);
    if (val === undefined) {
      return Response.json({ error: 'Invalid parameter: q must be 1-100' }, { status: 400 });
    }
    imageOpts.quality = val;
  }

  const blur = params.get('blur');
  if (blur !== null) {
    const val = clamp(blur, 1, 250);
    if (val === undefined) {
      return Response.json({ error: 'Invalid parameter: blur must be 1-250' }, { status: 400 });
    }
    imageOpts.blur = val;
  }

  const sharpen = params.get('sharpen');
  if (sharpen !== null) {
    const val = clamp(sharpen, 1, 10);
    if (val === undefined) {
      return Response.json({ error: 'Invalid parameter: sharpen must be 1-10' }, { status: 400 });
    }
    imageOpts.sharpen = val;
  }

  const gravity = params.get('gravity');
  if (gravity !== null) {
    if (!VALID_GRAVITY.has(gravity)) {
      return Response.json({ error: `Invalid parameter: gravity must be one of ${[...VALID_GRAVITY].join(', ')}` }, { status: 400 });
    }
    imageOpts.gravity = gravity;
  }

  // --- Resolve origin URL (SSRF protection: reject absolute URLs) ---
  if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
    return Response.json(
      { error: 'Absolute URLs are not allowed. Use a relative path (e.g., /project/v1/logos/logo.webp).' },
      { status: 400 }
    );
  }
  if (assetUrl.includes('..') || assetUrl.includes('\0') || assetUrl.includes('//')) {
    return Response.json(
      { error: 'Invalid path: contains disallowed sequences.' },
      { status: 400 }
    );
  }
  const originUrl = new URL(assetUrl, url.origin).toString();

  // --- Fetch with Cloudflare Image Resizing ---
  try {
    const response = await fetch(originUrl, {
      cf: { image: imageOpts },
    });

    if (!response.ok) {
      return Response.json(
        { error: `Upstream returned ${response.status}` },
        { status: response.status >= 400 && response.status < 500 ? 400 : 502 }
      );
    }

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Vary', 'Accept');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    return Response.json(
      { error: 'Failed to transform image' },
      { status: 500 }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  });
}
