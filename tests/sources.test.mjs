// 文化部以外的活動來源（apps-script/SourcesLib.gs）。樣本在 tests/fixtures/sources/，
// 是 2026-11-27 從各網站抓的真實公開資料，只留解析需要的部分。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const gas = vm.createContext({});
vm.runInContext(['Lib.gs', 'EventsLib.gs', 'SourcesLib.gs'].map((f) => read('../apps-script/' + f)).join('\n'), gas);
const J = (x) => JSON.parse(JSON.stringify(x));
const fx = (f) => read('./fixtures/sources/' + f);
const FROM = '2026-11-27', TO = '2027-02-26';
const isRow = (r) => /^[A-Za-z0-9_-]{1,64}$/.test(r.uid) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.start) && r.end >= r.start &&
  (r.city === '臺北' || r.city === '桃園') && r.title && r.src && r.catName;

test('srcIsoToTaipei_／srcDecode_', () => {
  assert.equal(gas.srcIsoToTaipei_('2026-12-10T10:30:00'), '2026-12-10 18:30', '沒有時區＝UTC');
  assert.equal(gas.srcIsoToTaipei_('2026-12-10T18:30:00+08:00'), '2026-12-10 18:30');
  assert.equal(gas.srcIsoToTaipei_('2026-12-31T20:00:00Z'), '2027-01-01 04:00', '跨日跨年');
  assert.equal(gas.srcIsoToTaipei_('明天'), null);
  assert.equal(gas.srcDecode_('A&amp;B &lt;C&gt; &#20013;&#x6587; <![CDATA[x]]>'), 'A&B <C> 中文 x');
});

test('桃園觀光行事曆（開放資料 XML）', () => {
  const r = J(gas.tycgParse_(fx('tycg-calendar.xml'), FROM, TO));
  assert.equal(r.parsed, 5, '每筆都解析得到');
  assert.ok(r.rows.length >= 1 && r.rows.length <= 3, '只留還沒結束的');
  assert.ok(r.rows.every(isRow));
  assert.ok(r.rows.every((x) => x.uid.startsWith('tycg-') && x.src === '桃園觀光導覽網' && x.url.startsWith('https://travel.tycg.gov.tw/')));
  assert.ok(r.rows.every((x) => x.city === '桃園'));
  assert.equal(J(gas.tycgParse_('<html>改版了</html>', FROM, TO)).parsed, 0);
});

test('臺北旅遊網（活動年曆 JSON）', () => {
  const r = J(gas.taipeiParse_(fx('taipei-season.json'), FROM, TO));
  assert.equal(r.parsed, 7);
  assert.ok(r.rows.length >= 1, '有還沒結束的節慶');
  assert.ok(r.rows.every(isRow));
  assert.ok(r.rows.every((x) => x.uid.startsWith('taipei-') && x.catName === '節慶' && /travel\.taipei/.test(x.url)));
  assert.ok(r.rows.every((x) => x.start.endsWith('00:00')), '只有日期');
  assert.equal(J(gas.taipeiParse_('{"success":false}', FROM, TO)).parsed, 0);
  assert.equal(J(gas.taipeiParse_('<!DOCTYPE html>Just a moment...', FROM, TO)).parsed, 0, 'Cloudflare 驗證頁');
});

test('Accupass：首頁列表（RSC）＋活動頁 JSON-LD', () => {
  const items = J(gas.accupassParseList_(fx('accupass-home.html')));
  assert.equal(items.length, 6, 'RSC 分成兩段也要串起來解析');
  assert.deepEqual([...new Set(items.map((x) => x.city))].sort(), [null, '桃園', '臺北'].sort());
  const xmas = items.find((x) => x.id === '2610271121376513690090');
  assert.equal(xmas.start, '2026-12-10 18:30', '列表的時間是 UTC，要轉台北時間');

  const d = J(gas.srcLdEvent_(fx('accupass-event.html')));
  assert.equal(d.start, '2026-12-10 18:30');
  assert.equal(d.end, '2026-12-27 18:30');
  assert.match(d.addr, /台北市大同區西寧北路/);

  const rows = J(gas.accupassRows_(items, { [xmas.id]: d }, FROM, TO));
  assert.ok(rows.every(isRow));
  assert.ok(!rows.some((x) => /New Taipei|Keelung/.test(x.addr)));
  assert.equal(rows.filter((x) => x.city === '臺北').length + rows.filter((x) => x.city === '桃園').length, rows.length);
  const xr = rows.find((x) => x.uid === 'accupass-2610271121376513690090');
  assert.equal(xr.addr, '台北市大同區西寧北路65-67號', '有活動頁時用完整地址（去掉「台灣」）');
  assert.equal(xr.url, 'https://www.accupass.com/event/2610271121376513690090');
  assert.ok(rows.length >= 3, '台北 3 筆＋桃園 1 筆（若在區間內）');
  assert.deepEqual(J(gas.accupassParseList_('<html></html>')), []);
});

test('JOIN+1：sitemap＋活動頁', () => {
  const urls = J(gas.join1ParseSitemap_(fx('join1-events-sitemap.xml')));
  assert.equal(urls.length, 3);
  assert.match(urls[0].code, /^[A-Z0-9]+$/);
  assert.match(urls[0].lastmod, /^2026-/);

  const e = J(gas.join1ParseEvent_(fx('join1-event.html')));
  assert.deepEqual({ ...e }, {
    title: '這個可以聊嗎？', start: '2026-11-27 20:00', end: '2026-11-27 23:00',
    addr: '新竹縣竹北市大同街76號1樓', venue: '波粼 Polybox', price: '現場收費'
  });
  // 新竹的活動不收；同一頁改成台北地址就收
  assert.equal(J(gas.join1Rows_([{ ...e, code: 'AJXGRH' }], FROM, TO)).length, 0);
  const tp = J(gas.join1Rows_([{ ...e, code: 'AJXGRH', addr: '臺北市大安區復興南路一段1號' }], FROM, TO));
  assert.equal(tp.length, 1);
  assert.ok(isRow(tp[0]));
  assert.equal(tp[0].url, 'https://join1.app/event/AJXGRH');
  assert.equal(gas.join1ParseEvent_('<html><head></head><body>改版了</body></html>'), null);
});

test('evMergeRows_：文化部為主，同標題同一天的其他來源視為重複', () => {
  const row = (uid, title, start, src = 'x') => ({ uid, title, start, end: start, src });
  const primary = [row('moc1', '【特展】請戲-布袋戲一條街', '2026-12-01 09:00'), row('moc1', '【特展】請戲-布袋戲一條街', '2026-12-01 14:00')];
  const extras = [
    row('accupass-1', '特展 請戲－布袋戲一條街', '2026-12-01 10:00'),   // 和文化部重複（標題標點不同）
    row('accupass-2', '耶誕市集', '2026-12-05 12:00'),
    row('join1-3', '耶誕市集', '2026-12-05 15:00'),                       // 和 Accupass 重複
    row('join1-4', '耶誕市集', '2026-12-06 15:00')                        // 不同天，保留
  ];
  const out = J(gas.evMergeRows_(primary, extras)).map((r) => r.uid);
  assert.deepEqual(out, ['moc1', 'moc1', 'accupass-2', 'join1-4']);
});
