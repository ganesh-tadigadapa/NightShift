// Rasterises the NightShift icon (a crescent moon on a rounded night-sky tile)
// into PNGs without any image dependencies. Produces an "on" and a dimmed "off" set.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const outDir = resolve(fileURLToPath(import.meta.url), '../../public/icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const encodePng = (size, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const lerp = (a, b, t) => a + (b - a) * t;
const inRoundRect = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inMoon = (x, y) =>
  (x - 0.48) ** 2 + (y - 0.52) ** 2 <= 0.27 ** 2 && (x - 0.62) ** 2 + (y - 0.4) ** 2 > 0.235 ** 2;
const STARS = [
  [0.74, 0.7, 0.028],
  [0.8, 0.26, 0.022],
];
const inStar = (x, y) => STARS.some(([sx, sy, r]) => Math.abs(x - sx) + Math.abs(y - sy) <= r * 1.6);

function render(size, off) {
  const out = Buffer.alloc(size * size * 4);
  const ss = 5; // supersampling grid
  const top = off ? [52, 54, 60] : [64, 58, 140];
  const bottom = off ? [24, 25, 29] : [14, 16, 34];
  const moon = off ? [150, 152, 160] : [246, 222, 160];
  const star = off ? [120, 122, 130] : [200, 205, 255];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          if (!inRoundRect(x, y, 0.22)) continue;
          const t = Math.min(1, Math.max(0, (x + y) / 2));
          let c = [lerp(top[0], bottom[0], t), lerp(top[1], bottom[1], t), lerp(top[2], bottom[2], t)];
          if (inMoon(x, y)) c = moon;
          else if (inStar(x, y)) c = star;
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const i = (py * size + px) * 4;
      const n = ss * ss;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, out);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(outDir, `icon-${size}.png`), render(size, false));
  writeFileSync(resolve(outDir, `icon-off-${size}.png`), render(size, true));
}
console.log('NightShift: icons written to public/icons');
