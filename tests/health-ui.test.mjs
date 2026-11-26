// App 上方的 API 異常提示文字（docs/js/lib/health.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtTime, healthProblems, fallbackSources, STATUS_LABEL } from '../docs/js/lib/health.js';

test('fmtTime：台北時間 月/日 時:分', () => {
  assert.equal(fmtTime(Date.UTC(2026, 10, 25, 22, 5)), '11/26 06:05');
  assert.equal(fmtTime(0), '—');
});

test('healthProblems：只有 fail 與 stale 會提示', () => {
  const t = Date.UTC(2026, 10, 25, 22, 5);
  const list = healthProblems([
    { key: 'culture', name: '文化部藝文活動', status: 'fail', since: t, fails: 3 },
    { key: 'line', name: 'LINE 推播', status: 'ok' },
    { key: 'x', name: '某來源', status: 'unknown' }
  ]);
  assert.deepEqual(list, ['文化部藝文活動抓不到資料（11/26 06:05 起，連續 3 次）']);
  assert.deepEqual(healthProblems([{ name: 'LINE 推播', status: 'fail', since: t, fails: 1 }]), ['LINE 推播抓不到資料（11/26 06:05 起）']);
  assert.match(healthProblems([{ name: '文化部藝文活動', status: 'stale', lastOk: t }])[0], /超過 2 天沒有更新（最後成功 11\/26 06:05/);
  assert.deepEqual(healthProblems(null), []);
  assert.equal(STATUS_LABEL.fail, '異常');
});

test('fallbackSources：抓不到又有網址的來源才顯示「到網站找」', () => {
  const src = [
    { key: 'culture', name: '文化部藝文活動', status: 'ok', link: 'https://event.culture.tw/' },
    { key: 'accupass', name: 'Accupass', status: 'fail', link: 'https://www.accupass.com/?area=north', scrape: true },
    { key: 'join1', name: 'JOIN+1', status: 'stale', link: 'https://join1.app/discover?r=nearby', scrape: true },
    { key: 'taipei', name: '臺北旅遊網', status: 'unknown', link: 'https://www.travel.taipei/zh-tw/event-calendar/2026', scrape: true },
    { key: 'line', name: 'LINE 推播', status: 'fail', link: '' }
  ];
  assert.deepEqual(fallbackSources(src).map((s) => s.key), ['accupass', 'join1']);
  assert.deepEqual(fallbackSources(undefined), []);
  assert.match(healthProblems([src[1]])[0], /網頁可能改版，需要修 tool$/);
});
