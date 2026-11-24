// 活動頁本機快取（docs/js/lib/eventcache.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResultCache, loadPrefs, savePrefs, loadFavData, saveFavData } from '../docs/js/lib/eventcache.js';

/** 模擬 localStorage；limit = 可存的總字元數（模擬容量滿） */
function memStore(limit = Infinity) {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const used = [...m].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0);
      if (used + v.length > limit) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k) => m.delete(k)
  };
}
const result = (start, end, n = 1) => ({ range: { start, endExclusive: end }, fetched: '2026-11-25', events: Array.from({ length: n }, (_, i) => ({ uid: 'u' + i })) });

test('createResultCache：存取、最近使用優先、最多 max 個', () => {
  const store = memStore();
  const c = createResultCache({ store, max: 3 });
  assert.equal(c.get('a'), null);
  c.put('a', result('2026-11-25', '2026-11-30'), 1);
  c.put('b', result('2026-11-30', '2026-12-07'), 2);
  c.put('c', result('2026-11-25', '2026-12-25'), 3);
  c.put('a', result('2026-11-25', '2026-11-30', 2), 4);   // 重新使用 a
  c.put('d', result('2026-12-01', '2026-12-08'), 5);      // 擠掉最舊的 b
  assert.equal(c.get('b'), null);
  assert.equal(c.get('a').data.events.length, 2);
  assert.equal(c.get('a').savedAt, 4);
  assert.ok(c.get('c') && c.get('d'));
  // 重新建立（等於重開 App）也讀得到
  assert.ok(createResultCache({ store, max: 3 }).get('d'));
});

test('createResultCache：容量不夠時丟最舊的；連一筆都存不下就清空', () => {
  const store = memStore(2200);   // 約可放 2 筆 60 個活動的結果
  const c = createResultCache({ store, max: 5 });
  c.put('a', result('2026-11-25', '2026-11-30', 60));
  c.put('b', result('2026-11-30', '2026-12-07', 60));
  c.put('c', result('2026-12-07', '2026-12-14', 60));
  assert.ok(c.get('c'), '最新的一定在');
  assert.equal(c.get('a'), null, '最舊的被丟掉');
  assert.equal(c.put('huge', result('2026-11-25', '2026-12-25', 500)), false);
  assert.equal(c.get('c'), null);
  assert.equal(store.m.size, 0);
});

test('createResultCache：prune 丟掉已過去的區間', () => {
  const c = createResultCache({ store: memStore() });
  c.put('old', result('2026-11-20', '2026-11-25'));
  c.put('now', result('2026-11-25', '2026-11-30'));
  c.prune('2026-11-25');
  assert.equal(c.get('old'), null);
  assert.ok(c.get('now'));
});

test('壞掉或舊版本的資料一律當成沒有', () => {
  const store = memStore();
  store.setItem('lt.events.results', '{not json');
  store.setItem('lt.events.prefs', JSON.stringify({ v: 0, favs: ['x'] }));
  assert.equal(createResultCache({ store }).get('a'), null);
  assert.equal(loadPrefs(store).favs.size, 0);
  // 沒有 localStorage（私密瀏覽等）也不會出錯
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(createResultCache({ store: broken }).put('a', result('2026-11-25', '2026-11-30')), false);
  assert.equal(savePrefs({ favs: new Set(), hidden: new Set() }, broken), false);
});

test('收藏／移除狀態與收藏清單', () => {
  const store = memStore();
  savePrefs({ favs: new Set(['a', 'b']), hidden: new Set(['c']), syncedAt: 123 }, store);
  const p = loadPrefs(store);
  assert.deepEqual([...p.favs], ['a', 'b']);
  assert.deepEqual([...p.hidden], ['c']);
  assert.equal(p.syncedAt, 123);
  assert.equal(loadFavData(store), null);
  saveFavData({ favs: [{ uid: 'a' }], hidden: [] }, store);
  assert.equal(loadFavData(store).favs[0].uid, 'a');
});
