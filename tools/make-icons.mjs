// 產生 App 圖示（不需任何套件）：node tools/make-icons.mjs
// 圖案：藍底 + 2×2 白色圓角方塊（代表四個工具）。內容在中央 56% 內，可當 maskable 圖示。
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const outDir = fileURLToPath(new URL('../docs/icons/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const BG = [31, 111, 235];   // #1f6feb
const FG = [255, 255, 255];

// 回傳 (x,y) 是否落在白色方塊內（座標以 0..1 表示）
function inGlyph(x, y) {
  const start = 0.22, cell = 0.26, gap = 0.04, r = 0.06;
  for (const cx of [0, 1]) for (const cy of [0, 1]) {
    const x0 = start + cx * (cell + gap), y0 = start + cy * (cell + gap);
    if (x < x0 || x > x0 + cell || y < y0 || y > y0 + cell) continue;
    const dx = Math.max(x0 + r - x, 0, x - (x0 + cell - r));
    const dy = Math.max(y0 + r - y, 0, y - (y0 + cell - r));
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const SS = 4; // 4×4 超取樣做抗鋸齒
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        if (inGlyph((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)) hit++;
      }
      const a = hit / (SS * SS);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - a) + FG[i] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

for (const size of [180, 192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), png(size));
  console.log(`docs/icons/icon-${size}.png`);
}
