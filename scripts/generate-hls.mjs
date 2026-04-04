import { statSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const SEGMENT_DURATION = 10;
const ASSUMED_BITRATE = 2_500_000;
const SEGMENT_BYTES = (ASSUMED_BITRATE / 8) * SEGMENT_DURATION;

const STOCK_DIR = new URL('../stock/videos', import.meta.url).pathname;

export function generateHLS(videosDir = STOCK_DIR) {
  const mp4Files = readdirSync(videosDir).filter((f) => extname(f) === '.mp4');

  for (const file of mp4Files) {
    const name = basename(file, '.mp4');
    const filePath = join(videosDir, file);
    const { size } = statSync(filePath);
    const segmentCount = Math.ceil(size / SEGMENT_BYTES);
    const outDir = join(videosDir, name);

    mkdirSync(outDir, { recursive: true });

    // Master playlist
    const master = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '',
      '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,NAME="720p"',
      `720p.m3u8`,
      '',
    ].join('\n');

    writeFileSync(join(outDir, 'master.m3u8'), master);

    // Variant playlist
    const variant = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${SEGMENT_DURATION}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD', ''];

    for (let i = 0; i < segmentCount; i++) {
      const isLast = i === segmentCount - 1;
      const segBytes = isLast ? size - i * SEGMENT_BYTES : SEGMENT_BYTES;
      const segDuration = isLast ? (segBytes / SEGMENT_BYTES) * SEGMENT_DURATION : SEGMENT_DURATION;
      variant.push(`#EXTINF:${segDuration.toFixed(3)},`);
      variant.push(`/api/stream?video=${name}&segment=${i}`);
    }

    variant.push('#EXT-X-ENDLIST');
    variant.push('');

    writeFileSync(join(outDir, '720p.m3u8'), variant.join('\n'));

    console.log(`${name}: ${segmentCount} segments (${(size / 1024 / 1024).toFixed(2)} MB)`);
  }
}

// Run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateHLS();
  console.log('Done.');
}
