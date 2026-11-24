// 活動頁的本機快取（localStorage）：查詢結果、收藏／移除狀態、收藏清單。
// 重開 App 時先顯示上次的結果，資料不是今天的才向後端更新。所有讀寫都包在 try/catch，
// 存不進去（容量滿、私密瀏覽）時只是失去快取，不影響功能。

const VERSION = 1;                 // 資料格式改變時遞增，舊快取會被丟棄
const PREFIX = 'lt.events.';

function storage(s) {
  if (s) return s;
  try { return globalThis.localStorage || null; } catch { return null; }
}

function read(s, key) {
  try {
    const raw = s?.getItem(PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && obj.v === VERSION ? obj : null;
  } catch {
    return null;
  }
}

function write(s, key, obj) {
  try {
    s?.setItem(PREFIX + key, JSON.stringify({ ...obj, v: VERSION }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 查詢結果快取：key = `${start}|${endExclusive}`，最多保留 max 個（最近使用的優先），
 * 區間已過去的自動丟掉。容量不夠時從最舊的開始丟，直到存得進去。
 */
export function createResultCache({ store, max = 5 } = {}) {
  const s = storage(store);
  const load = () => read(s, 'results') || { entries: {}, order: [] };

  return {
    get(key) {
      const c = load();
      return c.entries[key] || null;     // { data, savedAt }
    },
    put(key, data, now = Date.now()) {
      const c = load();
      c.entries[key] = { data, savedAt: now };
      c.order = [key, ...c.order.filter((k) => k !== key)];
      while (c.order.length > max) delete c.entries[c.order.pop()];
      while (!write(s, 'results', c)) {
        if (c.order.length <= 1) { this.clear(); return false; }
        delete c.entries[c.order.pop()];
      }
      return true;
    },
    /** 丟掉結束日已過的區間（endExclusive <= today） */
    prune(today) {
      const c = load();
      const keep = c.order.filter((k) => (c.entries[k]?.data?.range?.endExclusive || '') > today);
      if (keep.length === c.order.length) return;
      const entries = {};
      for (const k of keep) entries[k] = c.entries[k];
      write(s, 'results', { entries, order: keep });
    },
    clear() {
      try { s?.removeItem(PREFIX + 'results'); } catch { /* 忽略 */ }
    }
  };
}

/** 收藏／移除狀態：{ favs: [...uid], hidden: [...uid], syncedAt } */
export function loadPrefs(store) {
  const p = read(storage(store), 'prefs');
  return {
    favs: new Set(Array.isArray(p?.favs) ? p.favs : []),
    hidden: new Set(Array.isArray(p?.hidden) ? p.hidden : []),
    syncedAt: typeof p?.syncedAt === 'number' ? p.syncedAt : 0
  };
}

export function savePrefs(prefs, store) {
  return write(storage(store), 'prefs', { favs: [...prefs.favs], hidden: [...prefs.hidden], syncedAt: prefs.syncedAt || 0 });
}

/** 收藏頁的最後一次結果（後端 events.prefs 的回應） */
export function loadFavData(store) {
  return read(storage(store), 'favs')?.data || null;
}

export function saveFavData(data, store) {
  return write(storage(store), 'favs', { data });
}
