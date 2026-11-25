// 外部 API 異常提示：App 開啟時（最多每 3 小時一次）向後端問 health，有異常就在上方顯示紅色提示條。
// 結果存在 localStorage，離線或後端暫時連不上時仍顯示上次的狀態。
import { call } from './api.js';
import { get, set, getToken } from './store.js';
import { healthProblems } from './lib/health.js';

const EVERY_MS = 3 * 60 * 60 * 1000;
const KEY = 'health';

export function cachedHealth() {
  try { return JSON.parse(get(KEY, 'null')); } catch { return null; }
}

function showBanner(sources) {
  const el = document.getElementById('health-banner');
  const text = document.getElementById('health-text');
  if (!el || !text) return;
  const problems = healthProblems(sources);
  text.textContent = problems.length ? `⚠️ ${problems.join('；')}` : '';
  el.hidden = problems.length === 0;
}

/**
 * @param {{ force?: boolean }} opts force：設定頁的「重新檢查」
 * @returns {Promise<{at:number, sources:any[]}|null>} 最新狀態（失敗時回上次存的）
 */
export async function checkHealth({ force = false } = {}) {
  const cached = cachedHealth();
  if (cached) showBanner(cached.sources);
  if (!getToken()) return cached;
  if (!force && cached && Date.now() - cached.at < EVERY_MS) return cached;
  try {
    const d = await call('health');
    const fresh = { at: Date.now(), sources: Array.isArray(d?.sources) ? d.sources : [] };
    set(KEY, JSON.stringify(fresh));
    showBanner(fresh.sources);
    return fresh;
  } catch (err) {
    if (force) throw err;
    return cached;   // 離線、後端還沒部署新版等：不打擾，下次再試
  }
}
