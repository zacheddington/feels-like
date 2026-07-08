// make-icons.mjs — generate the PWA icons from code, no image tools needed.
//
//   node tools/make-icons.mjs
//
// Writes icons/icon-512.png, icons/icon-192.png, icons/apple-touch-icon.png
// (thermometer on golden sand) and icons/icon-mono.png (white glyph on
// transparency, used by Android themed icons via the manifest "monochrome"
// purpose; iOS auto-tints the regular icon on its own).
//
// The mark is a minimalist thermometer: rounded stem with a carved tube,
// mercury sitting at ~60%, round bulb. Bold single glyph so iOS 18 tinted
// home screens render it legibly. Edit the geometry constants and re-run.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0xf0, 0xcf, 0x96];    // golden-hour sand
const INK = [0x3a, 0x2c, 0x1c];   // deep umber
const MONO = [0xff, 0xff, 0xff];  // themed icons use alpha as the mask

// Geometry, as fractions of the icon size
const STEM = { y1: 0.20, y2: 0.58, r: 0.085 }; // outer capsule
const CARVE = { y1: 0.235, y2: 0.45, r: 0.035 }; // empty upper tube
const BULB = { y: 0.70, r: 0.15 };

/* ---------- glyph coverage (2x2 subsample anti-aliasing) ---------- */

// Distance from point to the vertical segment x=cx, y in [y1, y2]
function segDist(px, py, cx, y1, y2) {
  const cy = Math.max(y1, Math.min(y2, py));
  return Math.hypot(px - cx, py - cy);
}

function inGlyph(px, py, s) {
  const cx = s / 2;
  const solid =
    segDist(px, py, cx, STEM.y1 * s, STEM.y2 * s) <= STEM.r * s ||
    Math.hypot(px - cx, py - BULB.y * s) <= BULB.r * s;
  const carved = segDist(px, py, cx, CARVE.y1 * s, CARVE.y2 * s) <= CARVE.r * s;
  return solid && !carved;
}

function coverage(x, y, s) {
  let c = 0;
  for (const sy of [0.25, 0.75]) {
    for (const sx of [0.25, 0.75]) {
      if (inGlyph(x + sx, y + sy, s)) c++;
    }
  }
  return c / 4;
}

function raster(size, mono) {
  const bpp = mono ? 4 : 3;
  const px = Buffer.alloc(size * size * bpp);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = coverage(x, y, size);
      const i = (y * size + x) * bpp;
      if (mono) {
        px[i] = MONO[0]; px[i + 1] = MONO[1]; px[i + 2] = MONO[2];
        px[i + 3] = Math.round(t * 255);
      } else {
        for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] + (INK[c] - BG[c]) * t);
      }
    }
  }
  return px;
}

/* ---------- minimal PNG encoder (filter 0; RGB or RGBA) ---------- */

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

function png(size, px, mono) {
  const bpp = mono ? 4 : 3;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;              // bit depth
  ihdr[9] = mono ? 6 : 2;   // color type: RGBA / truecolor RGB
  const stride = size * bpp + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    px.copy(raw, y * stride + 1, y * size * bpp, (y + 1) * size * bpp);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
const OUT = [
  [512, 'icon-512.png', false],
  [192, 'icon-192.png', false],
  [180, 'apple-touch-icon.png', false],
  [512, 'icon-mono.png', true],
];
for (const [size, name, mono] of OUT) {
  const file = new URL(`../icons/${name}`, import.meta.url);
  writeFileSync(file, png(size, raster(size, mono), mono));
  console.log(`icons/${name} (${size}x${size}${mono ? ', monochrome' : ''})`);
}
