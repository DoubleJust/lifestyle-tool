// App 上方的 API 異常提示文字（docs/js/lib/health.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtTime, healthProblems, STATUS_LABEL } from '../docs/js/lib/health.js';

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
