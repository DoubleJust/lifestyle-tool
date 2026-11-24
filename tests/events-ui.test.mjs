// 活動頁前端邏輯（docs/js/lib/events.js）：期間、標籤、篩選與分組
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayTaipei, addDays, weekday, dayLabel, presetRange, customRange, rangeLabel, showTime,
  filterEvents, groupByDay, safeUrl, showMatches
} from '../docs/js/lib/events.js';

test('todayTaipei：以台北時區換日', () => {
  assert.equal(todayTaipei(new Date('2026-11-24T15:59:00Z')), '2026-11-24');
  assert.equal(todayTaipei(new Date('2026-11-24T16:00:00Z')), '2026-11-25');
});

test('日期工具', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekday('2026-11-28'), 6);
  assert.equal(dayLabel('2026-12-05'), '12/5（六）');
});

test('presetRange：本週＝今天到週日、下週、未來 30 天', () => {
  assert.deepEqual(presetRange('thisweek', '2026-11-25'), { start: '2026-11-25', endExclusive: '2026-11-30' }); // 週三
  assert.deepEqual(presetRange('thisweek', '2026-11-29'), { start: '2026-11-29', endExclusive: '2026-11-30' }); // 週日只剩今天
  assert.deepEqual(presetRange('thisweek', '2026-11-30'), { start: '2026-11-30', endExclusive: '2026-12-07' }); // 週一整週
  // 下週和後端週五推播是同一週
  assert.deepEqual(presetRange('nextweek', '2026-11-27'), { start: '2026-11-30', endExclusive: '2026-12-07' });
  assert.deepEqual(presetRange('nextweek', '2026-11-29'), { start: '2026-11-30', endExclusive: '2026-12-07' });
  assert.deepEqual(presetRange('nextweek', '2026-11-30'), { start: '2026-12-07', endExclusive: '2026-12-14' });
  assert.deepEqual(presetRange('next30', '2026-11-25'), { start: '2026-11-25', endExclusive: '2026-12-25' });
  assert.equal(presetRange('custom', '2026-11-25'), null);
  assert.equal(presetRange('weekend', '2026-11-25'), null, '舊的「本週末」已拿掉');
});

test('showMatches：平日／週末／晚上', () => {
  const sh = (start, end = start) => ({ start, end });
  const week = { start: '2026-11-30', endExclusive: '2026-12-07' };
  assert.equal(showMatches(sh('2026-12-05 14:00'), { days: 'weekend' }), true);
  assert.equal(showMatches(sh('2026-12-05 14:00'), { days: 'weekday' }), false);
  assert.equal(showMatches(sh('2026-12-01 19:30'), { days: 'weekday', evening: true }), true);
  assert.equal(showMatches(sh('2026-12-01 19:00'), { evening: true }), true, '19:00 整算晚上');
  assert.equal(showMatches(sh('2026-12-01 18:59'), { evening: true }), false);
  assert.equal(showMatches(sh('2026-12-01 00:00'), { evening: true }), false, '沒寫時間不算晚上');
  // 跨日場次：區間內有一天符合就算
  assert.equal(showMatches(sh('2026-11-28 10:00', '2026-12-27 17:00'), { days: 'weekend' }, week), true);
  assert.equal(showMatches(sh('2026-11-28 10:00', '2026-12-27 17:00'), { days: 'weekday' }, week), true);
  assert.equal(showMatches(sh('2026-12-05 10:00', '2026-12-06 17:00'), { days: 'weekday' }, week), false, '只有週六日');
  assert.equal(showMatches(sh('2026-11-01 10:00', '2026-12-31 17:00'), { days: 'weekday' }, { start: '2026-12-05', endExclusive: '2026-12-07' }), false,
    '區間只有週末時，跨月展覽也不算平日');
});

test('customRange：結束日含當天，限制與後端一致', () => {
  const t = '2026-11-25';
  assert.deepEqual(customRange('2026-12-01', '2026-12-07', t), { start: '2026-12-01', endExclusive: '2026-12-08' });
  assert.deepEqual(customRange(t, t, t), { start: t, endExclusive: '2026-11-26' });
  assert.ok(customRange('2026-11-24', '2026-11-30', t).error, '早於今天');
  assert.ok(customRange('2026-12-07', '2026-12-01', t).error, '結束早於開始');
  assert.ok(customRange('2026-12-01', '2027-01-01', t).error, '超過 31 天');
  assert.ok(!customRange('2026-12-01', '2026-12-31', t).error, '剛好 31 天');
  assert.ok(customRange('2027-01-25', '2027-01-26', t).error, '超過 60 天後');
  assert.ok(customRange('', '2026-12-01', t).error);
});

test('rangeLabel／showTime', () => {
  assert.equal(rangeLabel({ start: '2026-11-30', endExclusive: '2026-12-07' }), '11/30（一）–12/6（日）');
  assert.equal(rangeLabel({ start: '2026-11-29', endExclusive: '2026-11-30' }), '11/29（日）');
  assert.equal(showTime({ start: '2026-12-05 14:30', end: '2026-12-05 16:00' }), '14:30–16:00');
  assert.equal(showTime({ start: '2026-12-05 14:30', end: '2026-12-05 14:30' }), '14:30');
  assert.equal(showTime({ start: '2026-12-05 00:00', end: '2026-12-05 00:00' }), '時間未提供');
  assert.equal(showTime({ start: '2026-12-05 14:30', end: '2026-12-05 16:00' }, true), '12/5（六） 14:30–16:00');
  assert.equal(showTime({ start: '2026-11-26 00:00', end: '2026-12-09 00:00' }), '11/26（四） – 12/9（三）');
  assert.equal(showTime({ start: '2026-12-12 11:00', end: '2026-12-27 19:00' }), '12/12（六） 11:00 – 12/27（日） 19:00');
});

const ev = (uid, catName, shows) => ({ uid, title: uid, catName, url: '', src: '', shows });
const s = (start, city) => ({ start, end: start, city, venue: 'v', addr: '', price: '', approx: false });
const data = {
  range: { start: '2026-11-30', endExclusive: '2026-12-07' },
  events: [
    ev('a', '音樂', [s('2026-11-30 19:00', '臺北'), s('2026-12-05 19:00', '桃園')]),
    ev('b', '戲劇', [s('2026-12-01 19:00', '桃園')]),
    ev('c', '音樂', [s('2026-12-02 19:00', '臺北')])
  ],
  ongoing: [ev('d', '展覽', [s('2026-10-01 10:00', '臺北')])]
};

test('filterEvents：縣市以場次為單位、類別數量只算區間內開演', () => {
  const all = filterEvents(data);
  assert.equal(all.total, 3);
  assert.deepEqual(all.cats, [{ name: '音樂', count: 2 }, { name: '戲劇', count: 1 }, { name: '展覽', count: 0 }]);

  const ty = filterEvents(data, { city: '桃園' });
  assert.deepEqual(ty.events.map((e) => e.uid), ['b', 'a'], '只剩桃園場次，a 的第一場變成 12/5，重新排序');
  assert.deepEqual(ty.events[1].shows.map((x) => x.city), ['桃園']);
  assert.equal(ty.ongoing.length, 0);

  const music = filterEvents(data, { cat: '音樂' });
  assert.deepEqual(music.events.map((e) => e.uid), ['a', 'c']);
  assert.equal(music.total, 3, 'total 是類別篩選前的數量（給「全部」chip 用）');
  assert.equal(data.events[0].shows.length, 2, '不修改原始資料');
});

test('filterEvents：日子、晚上、已移除', () => {
  const we = filterEvents(data, { days: 'weekend' });
  assert.deepEqual(we.events.map((e) => [e.uid, e.shows.length]), [['a', 1]], 'a 只剩 12/5（六）那場');
  assert.equal(we.events[0].shows[0].start, '2026-12-05 19:00');
  assert.equal(filterEvents(data, { days: 'weekday', city: '桃園' }).events.map((e) => e.uid).join(), 'b');
  const late = { ...data, events: [...data.events, ev('e', '講座', [s('2026-12-03 14:00', '臺北')])] };
  assert.ok(!filterEvents(late, { evening: true }).events.some((e) => e.uid === 'e'));
  const hid = filterEvents(data, { hidden: new Set(['a', 'd']) });
  assert.deepEqual(hid.events.map((e) => e.uid), ['b', 'c']);
  assert.equal(hid.ongoing.length, 0);
  assert.equal(hid.total, 2);
});

test('groupByDay：依第一個場次的日期分組', () => {
  const g = groupByDay(filterEvents(data).events);
  assert.deepEqual(g.map((x) => [x.day, x.events.map((e) => e.uid)]),
    [['2026-11-30', ['a']], ['2026-12-01', ['b']], ['2026-12-02', ['c']]]);
});

test('safeUrl：只接受 http(s)', () => {
  assert.equal(safeUrl('https://www.opentix.life/program/1'), 'https://www.opentix.life/program/1');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://a b'), '');
  assert.equal(safeUrl(null), '');
});
