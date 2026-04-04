export const SEGMENT_DURATION = 10;
export const ASSUMED_BITRATE = 2_500_000; // ~2.5 Mbps estimate for source files
export const SEGMENT_BYTES = (ASSUMED_BITRATE / 8) * SEGMENT_DURATION; // bytes per segment

const VALID_QUALITIES = ['1080', '720', '480'];
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
};

const AVAILABLE_VIDEOS = ['black', 'mount_fuji', 'nature'];

function m3u8Response(body, cacheSecs = 300) {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': `public, max-age=${cacheSecs}`,
      ...CORS_HEADERS,
    },
  });
}

function errorResponse(message, status = 400) {
  return Response.json({ error: message }, { status, headers: CORS_HEADERS });
}

function generateMasterPlaylist(video) {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '',
    '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,NAME="720p"',
    `/api/stream?video=${video}&quality=720`,
    '',
  ].join('\n');
}

function generateVariantPlaylist(video, fileSize) {
  const segmentCount = Math.ceil(fileSize / SEGMENT_BYTES);
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${SEGMENT_DURATION}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '',
  ];

  for (let i = 0; i < segmentCount; i++) {
    const isLast = i === segmentCount - 1;
    const segBytes = isLast ? fileSize - i * SEGMENT_BYTES : SEGMENT_BYTES;
    const segDuration = isLast
      ? (segBytes / SEGMENT_BYTES) * SEGMENT_DURATION
      : SEGMENT_DURATION;
    lines.push(`#EXTINF:${segDuration.toFixed(3)},`);
    lines.push(`/api/stream?video=${video}&quality=720&segment=${i}`);
  }

  lines.push('#EXT-X-ENDLIST');
  lines.push('');
  return lines.join('\n');
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const video = url.searchParams.get('video');
  const quality = url.searchParams.get('quality');
  const segment = url.searchParams.get('segment');

  if (!video || !AVAILABLE_VIDEOS.includes(video)) {
    return errorResponse(`Invalid video. Available: ${AVAILABLE_VIDEOS.join(', ')}`);
  }

  // Master playlist — no quality specified
  if (!quality && segment === null) {
    return m3u8Response(generateMasterPlaylist(video));
  }

  // Validate quality when provided
  if (quality && !VALID_QUALITIES.includes(quality)) {
    return errorResponse(`Invalid quality. Available: ${VALID_QUALITIES.join(', ')}`);
  }

  // Fetch the source file to get its size via HEAD
  const videoUrl = new URL(`/stock/videos/${video}.mp4`, url.origin);

  // Variant playlist — quality specified, no segment
  if (segment === null) {
    const headResp = await fetch(videoUrl.toString(), { method: 'HEAD' });
    if (!headResp.ok) {
      return errorResponse('Video not found', 404);
    }
    const fileSize = parseInt(headResp.headers.get('content-length'), 10);
    if (!fileSize) {
      return errorResponse('Cannot determine video size', 500);
    }
    return m3u8Response(generateVariantPlaylist(video, fileSize));
  }

  // Segment request
  const segIndex = parseInt(segment, 10);
  if (isNaN(segIndex) || segIndex < 0) {
    return errorResponse('Invalid segment index');
  }

  // Get file size
  const headResp = await fetch(videoUrl.toString(), { method: 'HEAD' });
  if (!headResp.ok) {
    return errorResponse('Video not found', 404);
  }
  const fileSize = parseInt(headResp.headers.get('content-length'), 10);
  if (!fileSize) {
    return errorResponse('Cannot determine video size', 500);
  }

  const segmentCount = Math.ceil(fileSize / SEGMENT_BYTES);
  if (segIndex >= segmentCount) {
    return errorResponse('Segment index out of range', 404);
  }

  const rangeStart = segIndex * SEGMENT_BYTES;
  const rangeEnd = Math.min(rangeStart + SEGMENT_BYTES - 1, fileSize - 1);

  const rangeResp = await fetch(videoUrl.toString(), {
    headers: { Range: `bytes=${rangeStart}-${rangeEnd}` },
  });

  if (!rangeResp.ok && rangeResp.status !== 206) {
    return errorResponse('Failed to fetch segment', 502);
  }

  return new Response(rangeResp.body, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(rangeEnd - rangeStart + 1),
      'Cache-Control': 'public, max-age=31536000, immutable',
      ...CORS_HEADERS,
    },
  });
}
