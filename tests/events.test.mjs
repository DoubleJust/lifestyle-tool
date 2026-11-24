// F3 活動篩選與 LINE 推播判斷的單元測試。
// apps-script/*.gs 不是 ES module，這裡用 node:vm 載入 Lib.gs + EventsLib.gs（兩者的頂層程式都不會呼叫 Apps Script 服務）。
// 測試樣本 tests/fixtures/culture-sample.json：2026-11-24 從文化部 API 挑出的 19 筆公開資料，只留需要的欄位。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const gas = vm.createContext({});
vm.runInContext(read('../apps-script/Lib.gs') + '\n' + read('../apps-script/EventsLib.gs'), gas);
const raw = JSON.parse(read('./fixtures/culture-sample.json'));
// vm 內建立的物件原型不同，比對前先轉成一般 JSON
const J = (x) => JSON.parse(JSON.stringify(x));

const UID = {
  nextMon: '6af0ad0526b3245efc7537ab',      // 臺北市 11/30
  sat: '6af4a17a26b3245efc7537bf',          // 臺北市 12/5 14:00
  taipeiSpelling: '6ac28f8826b324165c32e593', // 台北市 12/5 17:00
  taoyuanTour: '6a9857dd26b32434f43580b9',  // 桃園 12/5、台北 12/12、12/13
  taoyuanDistrictOnly: '69c4502326b3242a48a9de5f', // 「桃園市桃園區」到 11/28
  dupUid: '6a606d4f647ad700eb56cccb',       // 只寫「中正區」，且 UID 重複兩次
  zhongshanOnly: '6a3a53b7647a40ec65297abd', // 只寫「中山區」，到 11/30
  shortTaipei: '6afe96fa647ad3bb538f97ac',  // 「北市民生東路」
  banqiao: '6ad7a1c726b3245efc7536e4',      // 新北市板橋（座標在台北矩形內）
  xindian: '6adaf45a647ad3bb538f9780',      // 「新店區」沒寫縣市
  kaohsiung: '6a2c3bea26b3243414ccd21b',
  longExpo: '69fa478a26b3243414ccc5c1',     // 3/10～12/15 展覽
  manyShows: '674de83326b324689882a4b2',    // 12 個場次
  ampersand: '6ada44ba26b3245efc753709',
  noUrl: '6ad46eeaeb43ead9f13aebcc',
  touringTaichung: '6aa97d4126b324165c32e40a', // 台北 11/25＋台中 11/27
  online: '619e1cadd083a3a56c535538',       // location 空白
  allDay: '6ae19da726b3245efc753731'        // 00:00～00:00
};

test('evParseTime_：文化部時間格式', () => {
  assert.equal(gas.evParseTime_('2026/11/25 14:30:00'), '2026-11-25 14:30');
  assert.equal(gas.evParseTime_('2026/1/5'), '2026-01-05 00:00');
  assert.equal(gas.evParseTime_(''), null);
  assert.equal(gas.evParseTime_(null), null);
  assert.equal(gas.evParseTime_('明年春天'), null);
});

test('evCityOf_：地址縣市優先，臺／台都要認得', () => {
  const c = (loc, lat = null, lng = null) => J(gas.evCityOf_(loc, lat, lng));
  assert.deepEqual(c('臺北市中正區中山南路21-1號'), { city: '臺北', approx: false });
  assert.deepEqual(c('台北市萬華區漢中街116號8樓'), { city: '臺北', approx: false });
  assert.deepEqual(c('100臺北市中正區'), { city: '臺北', approx: false });
  assert.deepEqual(c('桃園市中壢區中美路16號'), { city: '桃園', approx: false });
  assert.deepEqual(c('桃園縣中壢市'), { city: '桃園', approx: false });
  assert.deepEqual(c('北市民生東路二段24號'), { city: '臺北', approx: false });
  // 明確寫了別的縣市：不看座標
  assert.equal(c('新北市板橋區府中路15號B1', '25.0093775', '121.4596226').city, null);
  assert.equal(c('臺北縣板橋市').city, null);
  assert.equal(c('臺中市大安區').city, null);
  assert.equal(c('高雄市鳳山區三多一路1號').city, null);
});

test('evCityOf_：只寫行政區、經緯度後備', () => {
  const c = (loc, lat = null, lng = null) => J(gas.evCityOf_(loc, lat, lng));
  assert.deepEqual(c('中正區同安街107號'), { city: '臺北', approx: true });
  assert.deepEqual(c('文山區指南路二段64號'), { city: '臺北', approx: true });
  assert.deepEqual(c('中壢區中美路16號'), { city: '桃園', approx: true });
  // 基隆也有中正區、台中也有大安區：有座標時要落在台北範圍
  assert.equal(c('中正區信一路177號', '25.1318', '121.7445').city, null);
  assert.equal(c('大安區中松路', '24.3500', '120.5900').city, null);
  assert.equal(c('中山區林森北路107號', '25.0525', '121.5250').city, '臺北');
  // 新北的區名不在名單 → 沒有座標就不收
  assert.equal(c('新店區湖子內路100號').city, null);
  // 完全看不出縣市 → 用座標
  assert.deepEqual(c('某展覽空間', '25.0400', '121.5600'), { city: '臺北', approx: true });
  assert.deepEqual(c('某展覽空間', '24.9500', '121.2200'), { city: '桃園', approx: true });
  assert.equal(c('', null, null).city, null);
  assert.equal(c('全臺灣').city, null);
});

test('evToShowRows_：只留台北／桃園，去重，依時間排序', () => {
  const rows = J(gas.evToShowRows_(raw, '2026-11-25', '2027-02-23'));
  const uids = new Set(rows.map((r) => r.uid));
  for (const u of [UID.banqiao, UID.xindian, UID.kaohsiung, UID.online]) assert.ok(!uids.has(u), u);
  for (const u of [UID.nextMon, UID.taipeiSpelling, UID.dupUid, UID.zhongshanOnly, UID.shortTaipei, UID.longExpo, UID.allDay]) {
    assert.ok(uids.has(u), u);
  }
  assert.ok(rows.every((r) => r.city === '臺北' || r.city === '桃園'));
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].start <= r.start), '依開始時間排序');

  // 同一 UID 出現兩次（不同類別）只留一筆，類別取第一次出現的
  const dup = rows.filter((r) => r.uid === UID.dupUid);
  assert.equal(dup.length, 1);
  assert.equal(dup[0].cat, '7');
  assert.equal(dup[0].approx, true);

  // 巡演：台中場次不收
  const tour = rows.filter((r) => r.uid === UID.touringTaichung);
  assert.deepEqual(tour.map((r) => r.start), ['2026-11-25 19:30']);
  // 桃園＋台北都有的巡演：各場次各自判斷縣市
  assert.deepEqual(rows.filter((r) => r.uid === UID.taoyuanTour).map((r) => r.city), ['桃園', '臺北', '臺北']);

  assert.equal(rows.filter((r) => r.uid === UID.manyShows).length, 12);
  const noUrl = rows.find((r) => r.uid === UID.noUrl);
  assert.equal(noUrl.url, '');
  const amp = rows.find((r) => r.uid === UID.ampersand);
  assert.match(amp.title, /林灝維&台北愛樂/);
  assert.match(amp.url, /^https:\/\//);
});

test('evToShowRows_：區間外的場次不收，跨區間的長期場次要收', () => {
  const rows = J(gas.evToShowRows_(raw, '2026-12-01', '2026-12-08'));
  const many = rows.filter((r) => r.uid === UID.manyShows).map((r) => r.start.slice(0, 10));
  assert.deepEqual(many, ['2026-12-01', '2026-12-02', '2026-12-04', '2026-12-05', '2026-12-07']);
  assert.ok(rows.some((r) => r.uid === UID.longExpo), '3/10～12/15 的展覽跨過區間');
  assert.ok(!rows.some((r) => r.uid === UID.dupUid), '11/26 就結束');
});

test('evToShowRows_：髒資料不會讓整批失敗', () => {
  const rows = J(gas.evToShowRows_([
    null, {}, { UID: 'x' },
    { UID: 'a', title: '  兩個  空白 ', showInfo: [null, { time: '亂寫' }, { time: '2026/12/01 10:00:00', endTime: '', location: '臺北市' }] },
    { UID: 'b', title: '倒過來', showInfo: [{ time: '2026/12/02 10:00:00', endTime: '2026/12/01 09:00:00', location: '臺北市' }],
      sourceWebPromote: 'javascript:alert(1)', webSales: 'https://ok.example/x' }
  ], '2026-11-25', '2027-01-01'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, '兩個 空白');
  assert.equal(rows[0].end, rows[0].start, '沒有結束時間 → 用開始時間');
  assert.equal(rows[1].end, rows[1].start, '結束早於開始 → 用開始時間');
  assert.equal(rows[1].url, 'https://ok.example/x', '不接受 javascript: 連結');
  assert.deepEqual(J(gas.evToShowRows_('not an array', '2026-11-25', '2027-01-01')), []);
});

// 以 2026-11-27（週五）的下週為例：11/30～12/6
const rows = gas.evToShowRows_(raw, '2026-11-25', '2027-02-23');
const week = J(gas.evNextWeekFrom_('2026-11-27'));

test('evNextWeekFrom_：下週一到下週日（半開區間）', () => {
  assert.deepEqual(week, { startDate: '2026-11-30', endDateExclusive: '2026-12-07' });
  assert.equal(gas.evNextWeekFrom_('2026-11-30').startDate, '2026-12-07', '週一執行取下週一');
  assert.equal(gas.evNextWeekFrom_('2026-11-29').startDate, '2026-11-30', '週日執行取隔天');
  assert.deepEqual(J(gas.evNextWeekFrom_('2026-12-26')), { startDate: '2026-12-28', endDateExclusive: '2027-01-04' });
});

test('evSearch_：區間內開演的活動，與「展期中」分開', () => {
  const r = J(gas.evSearch_(rows, week.startDate, week.endDateExclusive));
  assert.equal(r.total, 5);
  assert.deepEqual(r.events.map((e) => e.uid), [UID.nextMon, UID.manyShows, UID.sat, UID.taoyuanTour, UID.taipeiSpelling]);
  const many = r.events.find((e) => e.uid === UID.manyShows);
  assert.deepEqual(many.shows.map((s) => s.start.slice(5, 10)), ['12-01', '12-02', '12-04', '12-05'], '只列區間內的場次');
  assert.equal(many.catName, '戲劇');
  assert.equal(r.events.find((e) => e.uid === UID.taoyuanTour).shows.length, 1);

  assert.equal(r.ongoingTotal, 4);
  assert.deepEqual(r.ongoing.map((e) => e.uid), [UID.zhongshanOnly, UID.allDay, UID.longExpo, UID.noUrl], '依結束日排序');
  assert.equal(r.ongoing.find((e) => e.uid === UID.longExpo).until, '2026-12-15');
  assert.equal(r.truncated, false);

  const small = J(gas.evSearch_(rows, week.startDate, week.endDateExclusive, 2));
  assert.equal(small.events.length, 2);
  assert.equal(small.total, 5);
  assert.equal(small.truncated, true);
});

test('evWeekendFirst_：有週末場次的活動排前面', () => {
  const r = gas.evSearch_(rows, week.startDate, week.endDateExclusive);
  const order = J(gas.evWeekendFirst_(r.events)).map((x) => [x.ev.uid, x.show.start]);
  assert.deepEqual(order, [
    [UID.sat, '2026-12-05 14:00'],
    [UID.taoyuanTour, '2026-12-05 14:30'],
    [UID.taipeiSpelling, '2026-12-05 17:00'],
    [UID.manyShows, '2026-12-05 20:00'],
    [UID.nextMon, '2026-11-30 19:30']
  ]);
});

test('evWeeklyText_：週六、週日輪流挑，顯示時週末依時間排在前面', () => {
  const mk = (i, d, t) => ({ uid: 'w' + i, title: 'T' + i, cat: '1', url: '', src: '', start: `${d} ${t}`, end: `${d} ${t}`,
    city: '臺北', approx: false, venue: 'V', addr: '', price: '' });
  const list = [];
  for (let i = 0; i < 20; i++) list.push(mk(i, '2026-12-05', `${String(8 + (i % 12)).padStart(2, '0')}:${i < 12 ? '00' : '30'}`));
  for (let i = 20; i < 25; i++) list.push(mk(i, '2026-12-06', '10:00'));
  list.push(mk(99, '2026-12-01', '09:00'));
  const r = gas.evSearch_(list, week.startDate, week.endDateExclusive);
  const text = gas.evWeeklyText_(r, week, {});
  const days = [...text.matchAll(/\n\d+\. (\d+\/\d+)/g)].map((m) => m[1]);
  assert.equal(days.length, 15);
  assert.equal(days.filter((d) => d === '12/6').length, 5, '週日 5 個都有挑到');
  assert.equal(days.filter((d) => d === '12/1').length, 0, '週末活動夠多時不挑平日');
  assert.deepEqual(days, [...days].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })), '依日期顯示');
  assert.match(text, /其餘 11 個活動請開 App 查看/);
});

test('evWeeklyText_：推播內容與長度', () => {
  const r = gas.evSearch_(rows, week.startDate, week.endDateExclusive);
  const app = 'https://doublejust.github.io/lifestyle-tool/#events';
  const text = gas.evWeeklyText_(r, week, { appUrl: app });
  assert.match(text, /^📅 下週台北／桃園藝文活動\n11\/30（一）–12\/6（日），共 5 個（週末優先）/);
  assert.match(text, /\n1\. 12\/5（六）14:00\n/);
  assert.match(text, /12\/5（六）20:00 等 4 場/);
  assert.match(text, /📍 .+｜桃園/);
  assert.match(text, /🔗 https:\/\//);
  assert.match(text, /另有 4 個長期展覽或課程進行中/);
  assert.ok(text.endsWith(app));
  assert.ok(!/其餘/.test(text));

  const two = gas.evWeeklyText_(r, week, { maxItems: 2 });
  assert.match(two, /\n2\. /);
  assert.ok(!/\n3\. /.test(two));
  assert.match(two, /其餘 3 個活動請開 App 查看/);
});

test('evWeeklyText_：超過 3,500 字元時截斷並說明剩幾個', () => {
  const many = [];
  for (let i = 0; i < 60; i++) {
    const d = `2026-12-0${1 + (i % 6)}`;
    // 標題 120 字、場地 80 字（evToShowRows_ 截斷後的最大長度）
    many.push({ uid: 'u' + i, title: '很長的標題'.repeat(24), cat: '1', url: 'https://www.opentix.life/program/' + '9'.repeat(19), src: 'x',
      start: `${d} 19:30`, end: `${d} 21:00`, city: '臺北', approx: false, venue: '場地'.repeat(40), addr: '臺北市中正區', price: '' });
  }
  const r = gas.evSearch_(many, week.startDate, week.endDateExclusive);
  const text = gas.evWeeklyText_(r, week, { appUrl: 'https://example.com/#events' });
  assert.ok(text.length <= 3500, `長度 ${text.length}`);
  const shown = (text.match(/\n\d+\. /g) || []).length;
  assert.ok(shown >= 1 && shown < 15);
  assert.match(text, new RegExp(`其餘 ${60 - shown} 個活動請開 App 查看`));
  assert.ok(text.endsWith('https://example.com/#events'));
});

test('evWeeklyText_：下週沒有活動也要推一則說明', () => {
  const r = gas.evSearch_([], week.startDate, week.endDateExclusive);
  const text = gas.evWeeklyText_(r, week, {});
  assert.match(text, /共 0 個\n\n下週沒有找到活動。/);
});

test('linePushPlan_：去重、上限、重用 retry key', () => {
  const now = Date.UTC(2026, 10, 27, 10, 0);
  const lim = { daily: 5, monthly: 150 };
  const row = (o) => ({ ts: now - 3600e3, ymd: '2026-11-27', eventId: 'x', status: 'sent', retryKey: 'k', ...o });
  const plan = (rows, id = 'events-weekly:2026-11-30') => J(gas.linePushPlan_(rows, id, now, '2026-11-27', lim));

  assert.deepEqual(plan([]), { go: true, retryKey: null });
  assert.deepEqual(plan([row({ eventId: 'events-weekly:2026-11-30' })]), { go: false, reason: 'DUP' });
  // 上次送到一半（pending）→ 重送時沿用同一個 retry key
  assert.deepEqual(plan([row({ eventId: 'events-weekly:2026-11-30', status: 'pending', retryKey: 'K1' })]), { go: true, retryKey: 'K1' });
  assert.deepEqual(plan([row({ eventId: 'events-weekly:2026-11-30', status: 'failed', retryKey: 'K2' })]), { go: true, retryKey: 'K2' });
  // retry key 只有 24 小時有效：超過 23 小時就換新的
  assert.deepEqual(plan([row({ eventId: 'events-weekly:2026-11-30', status: 'pending', retryKey: 'old', ts: now - 30 * 3600e3, ymd: '2026-11-26' })]),
    { go: true, retryKey: null });

  const five = Array.from({ length: 5 }, (_, i) => row({ eventId: 'e' + i }));
  assert.deepEqual(plan(five), { go: false, reason: 'DAILY_LIMIT' });
  const failed = Array.from({ length: 5 }, (_, i) => row({ eventId: 'f' + i, status: 'failed' }));
  assert.equal(plan(failed).go, true, '失敗的不算用量');

  const month = Array.from({ length: 150 }, (_, i) => row({ eventId: 'm' + i, ymd: '2026-11-0' + (1 + (i % 9)) }));
  assert.deepEqual(plan(month), { go: false, reason: 'MONTHLY_LIMIT' });
  const lastMonth = Array.from({ length: 150 }, (_, i) => row({ eventId: 'o' + i, ymd: '2026-10-15' }));
  assert.equal(plan(lastMonth).go, true, '上個月的不算');
});

test('evSnapshot_：收藏快照只留乾淨的欄位', () => {
  const r = J(gas.evSearch_(rows, week.startDate, week.endDateExclusive));
  const many = r.events.find((e) => e.uid === UID.manyShows);
  const snap = J(gas.evSnapshot_(many));
  assert.equal(snap.uid, UID.manyShows);
  assert.equal(snap.catName, '戲劇');
  assert.equal(snap.shows.length, 4);
  assert.deepEqual(Object.keys(snap.shows[0]).sort(), ['addr', 'approx', 'city', 'end', 'price', 'start', 'venue']);

  const big = { ...many, shows: Array.from({ length: 30 }, () => many.shows[0]) };
  assert.equal(gas.evSnapshot_(big).shows.length, 10, '最多 10 個場次');
  assert.equal(gas.evSnapshot_({ ...many, uid: '../x' }), null);
  assert.equal(gas.evSnapshot_({ ...many, title: '  ' }), null);
  assert.equal(gas.evSnapshot_({ ...many, shows: [{ start: '明天', city: '臺北' }] }), null);
  assert.equal(gas.evSnapshot_({ ...many, shows: [{ ...many.shows[0], city: '高雄' }] }), null);
  assert.equal(gas.evSnapshot_({ ...many, url: 'javascript:alert(1)' }).url, '');
  assert.equal(gas.evSnapshot_(null), null);
});

test('evExcludeUids_：已移除的活動不出現在查詢與推播', () => {
  const hidden = { [UID.sat]: true, [UID.longExpo]: true };
  const r = J(gas.evSearch_(gas.evExcludeUids_(rows, hidden), week.startDate, week.endDateExclusive));
  assert.equal(r.total, 4);
  assert.ok(!r.events.some((e) => e.uid === UID.sat));
  assert.equal(r.ongoingTotal, 3);
});

test('evFavList_：用最新場次、過期的排最後、快取沒有時用快照', () => {
  const r = gas.evSearch_(rows, week.startDate, week.endDateExclusive);
  const snapOf = (uid) => gas.evSnapshot_(r.events.find((e) => e.uid === uid) || r.ongoing.find((e) => e.uid === uid));
  const favs = [
    { uid: UID.manyShows, at: '2026-11-20', snap: snapOf(UID.manyShows) },
    { uid: UID.nextMon, at: '2026-11-21', snap: snapOf(UID.nextMon) },
    { uid: 'gone', at: '2026-11-01', title: '舊活動', snap: { uid: 'gone', title: '舊活動', catName: '音樂', url: '', src: '',
      shows: [{ start: '2026-11-01 19:00', end: '2026-11-01 21:00', city: '臺北', venue: 'v', addr: '', price: '' }] } },
    { uid: 'nosnap', at: '2026-11-02', title: '沒有快照' }
  ];
  const list = J(gas.evFavList_(favs, rows, '2026-12-01'));
  assert.deepEqual(list.map((e) => [e.uid, e.ended]), [
    [UID.manyShows, false], [UID.nextMon, true], ['nosnap', true], ['gone', true]
  ], '進行中依下一場排序；已結束依收藏日新到舊');
  const many = list[0];
  assert.equal(many.shows[0].start, '2026-12-01 20:00', '從今天起的場次');
  assert.equal(many.shows.length, 8, '用快取裡 12/1 以後的全部場次，不是快照的 4 個');
  assert.equal(list.find((e) => e.uid === 'gone').shows.length, 1, '結束的保留快照場次');
  assert.equal(list.find((e) => e.uid === 'nosnap').title, '沒有快照');
});
