// 產生 App 圖示（不需任何套件）：node tools/make-icons.mjs
// 來源：tools/icon-source.png（擁有者 2026-11-25 提供：奶油底上的橘色圓角方塊，四格白底線條圖示＝四個工具）。
// 做法：找出橘色方塊、裁切，方塊外的圓角補成橘色（iOS／Android 會自己裁圓角），再縮放成各尺寸。
//   icon-180／192／512：滿版；icon-512-maskable：內容縮到 75%，讓 Android 裁成圓形時四格也不會被切掉。
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const srcPath = fileURLToPath(new URL('./icon-source.png', import.meta.url));
const outDir = fileURLToPath(new URL('../docs/icons/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const ORANGE = [224, 122, 58];   // #E07A3A（與 manifest theme_color 相同）

// ── PNG 解碼（只支援 8-bit RGB／RGBA、非交錯，夠用即可）──
function decodePng(buf) {
  let o = 8, w = 0, h = 0, color = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); color = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (color !== 2 && color !== 6)) throw new Error('只支援 8-bit RGB/RGBA、非交錯的 PNG');
    } else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const bpp = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const get = (x, y) => { const i = y * stride + x * bpp; return [px[i], px[i + 1], px[i + 2]]; };
  return { w, h, get };
}

function encodePng(size, get) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const c = get(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── 找出橘色方塊並建立「滿版」的取樣函式 ──
const src = decodePng(readFileSync(srcPath));
const isOrange = ([r, g, b]) => Math.abs(r - ORANGE[0]) < 24 && Math.abs(g - ORANGE[1]) < 28 && Math.abs(b - ORANGE[2]) < 28;
let x0 = src.w, x1 = -1, y0 = src.h, y1 = -1;
for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
  if (isOrange(src.get(x, y))) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
}
if (x1 < 0) throw new Error('來源圖片找不到橘色方塊');
const side = Math.max(x1 - x0, y1 - y0) + 1;
// 圓角半徑：沿對角線從角落往內找第一個橘色像素
let k = 0;
while (k < side / 2 && !isOrange(src.get(x0 + k, y0 + k))) k++;
const radius = k / (1 - Math.SQRT1_2);
console.log(`橘色方塊 ${side}px（${x0},${y0}），圓角約 ${Math.round(radius)}px`);

/** 方塊座標 (u,v)∈[0,side) 的顏色；圓角外與邊緣 1.5px 內一律用橘色 */
function squareColor(u, v) {
  const cx = Math.min(Math.max(u, radius), side - radius);
  const cy = Math.min(Math.max(v, radius), side - radius);
  const inside = radius - Math.hypot(u - cx, v - cy);           // >0 在圓角內
  const edge = Math.min(u, v, side - 1 - u, side - 1 - v);       // 到直邊的距離
  if (inside < 1.5 || edge < 1.5) return ORANGE;
  const x = Math.min(src.w - 1, Math.max(0, Math.round(x0 + u)));
  const y = Math.min(src.h - 1, Math.max(0, Math.round(y0 + v)));
  return src.get(x, y);
}

/** 輸出 size×size；scale<1 時內容縮小置中，外圍補橘色。每個像素 4×4 超取樣做平滑縮放。 */
function render(size, scale = 1) {
  const SS = 4;
  return encodePng(size, (x, y) => {
    const acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const nx = ((x + (sx + 0.5) / SS) / size - 0.5) / scale + 0.5;   // 0..1，在內容範圍內
      const ny = ((y + (sy + 0.5) / SS) / size - 0.5) / scale + 0.5;
      const c = nx < 0 || nx >= 1 || ny < 0 || ny >= 1 ? ORANGE : squareColor(nx * side, ny * side);
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    return acc.map((v) => Math.round(v / (SS * SS)));
  });
}

for (const size of [180, 192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), render(size));
  console.log(`docs/icons/icon-${size}.png`);
}
writeFileSync(join(outDir, 'icon-512-maskable.png'), render(512, 0.75));
console.log('docs/icons/icon-512-maskable.png');
