// 改版：同時更新 docs/js/config.js 的 APP_VERSION 與 docs/sw.js 的 CACHE_VERSION。
// 用法：node tools/bump-version.mjs          → 修訂號 +1（1.0.0 → 1.0.1）
//       node tools/bump-version.mjs minor    → 次版號 +1（1.0.3 → 1.1.0）
//       node tools/bump-version.mjs 2.0.0    → 指定版本
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cfgPath = fileURLToPath(new URL('../docs/js/config.js', import.meta.url));
const swPath = fileURLToPath(new URL('../docs/sw.js', import.meta.url));

const cfg = readFileSync(cfgPath, 'utf8');
const m = cfg.match(/APP_VERSION = '(\d+)\.(\d+)\.(\d+)'/);
if (!m) { console.error('找不到 APP_VERSION'); process.exit(1); }
let [maj, min, pat] = m.slice(1).map(Number);

const arg = process.argv[2] || 'patch';
let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg;
else if (arg === 'major') next = `${maj + 1}.0.0`;
else if (arg === 'minor') next = `${maj}.${min + 1}.0`;
else if (arg === 'patch') next = `${maj}.${min}.${pat + 1}`;
else { console.error(`不認得的參數：${arg}`); process.exit(1); }

const sw = readFileSync(swPath, 'utf8');
if (!/const CACHE_VERSION = '[^']*';/.test(sw)) { console.error('找不到 CACHE_VERSION'); process.exit(1); }

writeFileSync(cfgPath, cfg.replace(/APP_VERSION = '[^']*'/, `APP_VERSION = '${next}'`));
writeFileSync(swPath, sw.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = '${next}';`));
console.log(`${m[1]}.${m[2]}.${m[3]} → ${next}`);
