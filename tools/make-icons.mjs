// make-icons.mjs — generate the PWA icons from code, no image tools needed.
//
//   node tools/make-icons.mjs
//
// Writes icons/icon-512.png, icons/icon-192.png, icons/apple-touch-icon.png.
// The mark is the brand ring-and-dot on golden-hour sand (matches the
// favicon and the sky clock's golden stop). Edit the constants and re-run.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0xf0, 0xcf, 0x96];    // golden-hour sand
const INK = [0x3a, 0x2c, 0x1c];   // deep umber
const RING_R = 0.29, RING_W = 0.075, DOT_R = 0.105;

/* ---------- rasterize (2x2 subsample anti-aliasing) ---------- */

function raster(size) {
  const px = Buffer.alloc(size * size * 3);
  const cx = size / 2;
  const ringR = size * RING_R, ringHalfW = (size * RING_W) / 2, dotR = size * DOT_R;
  const subs = [0.25, 0.75];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (const sy of subs) {
        for (const sx of subs) {
          const d = Math.hypot(x + sx - cx, y + sy - cx);
          if (Math.abs(d - ringR) <= ringHalfW || d <= dotR) cover++;
        }
      }
      const t = cover / 4;
      const i = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] + (INK[c] - BG[c]) * t);
    }
  }
  return px;
}

/* ---------- minimal PNG encoder (8-bit RGB, filter 0) ---------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const [size, name] of [[512, 'icon-512.png'], [192, 'icon-192.png'], [180, 'apple-touch-icon.png']]) {
  const file = new URL(`../icons/${name}`, import.meta.url);
  writeFileSync(file, png(size, raster(size)));
  console.log(`icons/${name} (${size}x${size})`);
}
