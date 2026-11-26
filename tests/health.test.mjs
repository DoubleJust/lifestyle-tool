// 外部 API 健康狀態（apps-script/Health.gs 的純函式）與文化部資料品質檢查、過期清理（EventsLib.gs）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const gas = vm.createContext({});
vm.runInContext(['Lib.gs', 'EventsLib.gs', 'Health.gs'].map((f) => read('../apps-script/' + f)).join('\n'), gas);
const J = (x) => JSON.parse(JSON.stringify(x));
const H = 3600e3;

test('healthRecord_：成功清除失敗；連續失敗記住開始時間與次數', () => {
  let r = J(gas.healthRecord_(null, true, '', 1000));
  assert.deepEqual(r, { status: 'ok', at: 1000, lastOk: 1000, since: 0, fails: 0, msg: '' });
  r = J(gas.healthRecord_(r, false, 'HTTP 503', 2000));
  assert.deepEqual(r, { status: 'fail', at: 2000, lastOk: 1000, since: 2000, fails: 1, msg: 'HTTP 503' });
  r = J(gas.healthRecord_(r, false, 'timeout', 3000));
  assert.equal(r.since, 2000, '仍是第一次失敗的時間');
  assert.equal(r.fails, 2);
  assert.equal(r.msg, 'timeout');
  r = J(gas.healthRecord_(r, true, '', 4000));
  assert.equal(r.status, 'ok');
  assert.equal(r.fails, 0);
  assert.equal(J(gas.healthRecord_(null, false, 'x'.repeat(500), 1)).msg.length, 200);
});

test('healthReport_：太久沒檢查算 stale；沒紀錄算 unknown', () => {
  const now = 100 * H;
  const rep = (h) => J(gas.healthReport_(h, now));
  const byKey = (list) => Object.fromEntries(list.map((x) => [x.key, x]));
  let r = byKey(rep({}));
  assert.equal(r.culture.status, 'unknown');
  assert.equal(r.line.status, 'unknown');
  assert.equal(r.culture.name, '文化部藝文活動');
  r = byKey(rep({ culture: { status: 'ok', at: now - 47 * H, lastOk: now - 47 * H }, line: { status: 'ok', at: 1, lastOk: 1 } }));
  assert.equal(r.culture.status, 'ok');
  assert.equal(r.line.status, 'ok', 'LINE 不檢查多久沒用');
  r = byKey(rep({ culture: { status: 'ok', at: now - 49 * H, lastOk: now - 49 * H } }));
  assert.equal(r.culture.status, 'stale');
  r = byKey(rep({ culture: { status: 'fail', at: now, lastOk: 5, since: 7, fails: 3, msg: 'HTTP 500' } }));
  assert.deepEqual([r.culture.status, r.culture.since, r.culture.fails, r.culture.msg], ['fail', 7, 3, 'HTTP 500']);
});

test('evFeedProblem_：抓得到但內容可疑也算異常', () => {
  const raw = JSON.parse(read('./fixtures/culture-sample.json'));
  const rows = gas.evToShowRows_(raw, '2026-11-25', '2027-02-23');
  assert.equal(gas.evFeedProblem_(raw, rows), '');
  assert.match(gas.evFeedProblem_([], []), /空/);
  assert.match(gas.evFeedProblem_(raw.map((e) => ({ id: e.UID, name: e.title })), []), /格式可能改變/);
  const many = Array.from({ length: 120 }, (_, i) => ({ ...raw[0], UID: 'x' + i }));
  assert.match(gas.evFeedProblem_(many, []), /篩不出任何台北／桃園場次/);
  assert.equal(gas.evFeedProblem_(raw, []), '', '資料少時篩不出來不算異常');
});

test('evExpiredPrefUids_：今天以後沒有場次的收藏／移除紀錄', () => {
  const rows = [
    { uid: 'a', end: '2026-11-25 21:00' },
    { uid: 'b', end: '2026-12-31 17:00' },
    { uid: 'c', end: '2026-11-24 21:00' }
  ];
  const prefs = [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }, { uid: 'gone' }, { uid: 'gone' }];
  assert.deepEqual(J(gas.evExpiredPrefUids_(prefs, rows, '2026-11-25')), ['c', 'gone']);
  assert.deepEqual(J(gas.evExpiredPrefUids_([], rows, '2026-11-25')), []);
});

test('healthReport_：連結模式的來源抓不到時回報 link（不算異常）', () => {
  const now = 100 * H;
  const r = Object.fromEntries(J(gas.healthReport_({ taipei: { status: 'fail', at: now, since: now, fails: 3, msg: 'HTTP 403' }, accupass: { status: 'fail', at: now, since: now, fails: 2, msg: 'x' } }, now)).map((x) => [x.key, x]));
  assert.equal(r.taipei.status, 'link');
  assert.equal(r.taipei.msg, 'HTTP 403');
  assert.match(r.taipei.link, /event-calendar\/\d{4}$/);
  assert.equal(r.accupass.status, 'fail', '其他爬網頁來源照樣算異常');
});
