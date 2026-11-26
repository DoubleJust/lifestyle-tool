/**
 * 文化部以外的活動來源：解析成和 evToShowRows_ 一樣的「場次列」（純函式，tests/sources.test.mjs 測試）。
 * 2026-11-27 擁有者決定推翻規格 §0「不爬網頁」：臺北旅遊網、Accupass、JOIN+1 用解析網頁的方式取得；
 * 網頁改版或被擋時，Health.gs 會記為異常，App 改顯示「到網站找」的連結並提醒擁有者修理。
 *
 * 場次列：{ uid, title, cat, catName, url, src, start, end, city, approx, venue, addr, price }
 *   uid 加上來源前綴（tycg-／taipei-／accupass-／join1-），不會和文化部的 UID 撞在一起。
 */

const SRC_INFO_ = {
  taipei: { src: '臺北旅遊網', catName: '節慶' },
  tycg: { src: '桃園觀光導覽網', catName: '觀光活動' },
  accupass: { src: 'Accupass', catName: '民間活動' },
  join1: { src: 'JOIN+1', catName: '揪團聚會' }
};

function srcDecode_(s) {
  return String(s == null ? '' : s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/** ISO 時間（可帶時區）→ 台北時間 "yyyy-MM-dd HH:mm"；沒有時區的當成 UTC（Accupass 列表就是 UTC） */
function srcIsoToTaipei_(iso) {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z');
  if (isNaN(ms)) return null;
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** 共用：組成場次列，並只留台北／桃園、和 [from, toEx) 有重疊的 */
function srcRow_(key, o, from, toEx) {
  const info = SRC_INFO_[key];
  const title = evClean_(o.title, EV_MAX_TITLE_);
  if (!title || !o.start || !o.city) return null;
  let end = o.end || o.start;
  if (end < o.start) end = o.start;
  if (o.start.slice(0, 10) >= toEx || end.slice(0, 10) < from) return null;
  return {
    uid: (key + '-' + String(o.id)).replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 64),
    title: title, cat: '', catName: info.catName, url: evUrl_(o.url), src: info.src,
    start: o.start, end: end, city: o.city, approx: !!o.approx,
    venue: evClean_(o.venue, 80), addr: evClean_(o.addr, 120), price: evClean_(o.price, EV_MAX_PRICE_)
  };
}

/** 地址判斷縣市；看不出來時用 fallback（例如桃園自己的行事曆預設桃園），明確寫了別的縣市就不收 */
function srcCity_(addr, fallback, lat, lng) {
  const w = evCityOf_(addr, lat, lng);
  if (w.city) return w;
  if (EV_CITY_RE_.test(String(addr || ''))) return { city: null, approx: false };
  return { city: fallback || null, approx: !!fallback };
}

function srcSort_(rows) {
  return rows.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
}

// ── 桃園觀光導覽網「觀光行事曆」開放資料（XML） ──────────────────────
/** 回傳 { parsed: 解析到的活動數, rows } */
function tycgParse_(xml, from, toEx) {
  const blocks = String(xml || '').split('<Info>').slice(1);
  const tag = function (b, t) { const m = new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>').exec(b); return m ? srcDecode_(m[1]).trim() : ''; };
  const rows = [];
  let parsed = 0;
  blocks.forEach(function (b) {
    const start = evParseTime_(tag(b, 'Start'));
    const name = tag(b, 'Name');
    if (!start || !name) return;
    parsed++;
    const addr = tag(b, 'Add');
    const where = srcCity_(addr, '桃園', tag(b, 'Py'), tag(b, 'Px'));
    const r = srcRow_('tycg', {
      id: tag(b, 'InfoId'), title: name, url: tag(b, 'TYWebsite'), start: start, end: evParseTime_(tag(b, 'End')),
      city: where.city, approx: where.approx, venue: tag(b, 'Location') || addr, addr: addr,
      price: tag(b, 'OnlyHoliday') === 'true' ? '僅假日舉辦' : ''
    }, from, toEx);
    if (r) rows.push(r);
  });
  return { parsed: parsed, rows: srcSort_(rows) };
}

// ── 臺北旅遊網：活動年曆頁面用的 JSON（/api/zh-tw/event/season） ─────────
function taipeiParse_(json, from, toEx) {
  let obj = json;
  if (typeof json === 'string') { try { obj = JSON.parse(json); } catch (e) { obj = null; } }
  const data = obj && obj.data;
  const list = Array.isArray(data) ? data : data && typeof data === 'object'
    ? Object.keys(data).reduce(function (a, k) { return a.concat(Array.isArray(data[k]) ? data[k] : []); }, []) : [];
  const rows = [];
  const seen = {};
  let parsed = 0;
  list.forEach(function (x) {
    if (!x || !x.article_id || !x.title || seen[x.article_id]) return;
    const b = /^\d{4}-\d{2}-\d{2}/.test(x.date_begin || '') ? x.date_begin.slice(0, 10) : '';
    if (!b) return;
    seen[x.article_id] = true;
    parsed++;
    const e = /^\d{4}-\d{2}-\d{2}/.test(x.date_end || '') ? x.date_end.slice(0, 10) : b;
    const county = String(x.address_county || '') + String(x.address_township || '');
    const where = srcCity_(county + String(x.address || ''), '臺北', x.coordinate_nlat, x.coordinate_elong);
    const r = srcRow_('taipei', {
      id: x.article_id, title: srcDecode_(x.title), url: x.source_url || x.outlink, start: b + ' 00:00', end: e + ' 00:00',
      city: where.city, approx: where.approx, venue: srcDecode_(x.address), addr: county,
      price: [srcDecode_(x.time_description), srcDecode_(x.ticket)].filter(Boolean).join('；')
    }, from, toEx);
    if (r) rows.push(r);
  });
  return { parsed: parsed, rows: srcSort_(rows) };
}

// ── Accupass：首頁（北部）的 Next.js RSC 資料＋各活動頁的 JSON-LD ─────────
/** 把 self.__next_f.push([1,"..."]) 的字串串起來 */
function srcNextPayload_(html) {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m, out = '';
  while ((m = re.exec(String(html || '')))) { try { out += JSON.parse(m[1]); } catch (e) { /* 略過 */ } }
  return out;
}

/** 從字串中找出所有以 marker 開頭的 JSON 物件（大括號配對） */
function srcObjectsAt_(p, marker) {
  const res = [];
  let i = 0;
  while ((i = p.indexOf(marker, i)) >= 0) {
    let d = 0, j = i, inStr = false;
    for (; j < p.length; j++) {
      const c = p[j];
      if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') d++;
      else if (c === '}') { d--; if (!d) break; }
    }
    try { res.push(JSON.parse(p.slice(i, j + 1))); } catch (e) { /* 略過 */ }
    i = j + 1;
  }
  return res;
}

const ACC_CITY_ = { 'Taipei City': '臺北', 'Taoyuan City': '桃園' };

/** 首頁列表 → [{ id, name, start, end, city, offline }]（時間已轉台北時間） */
function accupassParseList_(html) {
  const seen = {};
  return srcObjectsAt_(srcNextPayload_(html), '{"eventId":"').filter(function (o) {
    if (!o || !o.eventId || !o.name || seen[o.eventId]) return false;
    seen[o.eventId] = true;
    return true;
  }).map(function (o) {
    return {
      id: String(o.eventId), name: srcDecode_(o.name),
      start: srcIsoToTaipei_(o.startDateTime), end: srcIsoToTaipei_(o.endDateTime),
      city: ACC_CITY_[o.location] || null, offline: o.eventPlaceType !== 'Online'
    };
  });
}

/** 活動頁的 schema.org Event → { start, end, venue, addr, price }；找不到回 null */
function srcLdEvent_(html) {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    let j;
    try { j = JSON.parse(m[1]); } catch (e) { continue; }
    const list = Array.isArray(j) ? j : j && j['@graph'] ? j['@graph'] : [j];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e['@type'] !== 'Event') continue;
      const loc = e.location || {};
      const addr = typeof loc.address === 'string' ? loc.address
        : loc.address ? [loc.address.addressRegion, loc.address.addressLocality, loc.address.streetAddress].filter(Boolean).join('') : '';
      const offers = Array.isArray(e.offers) ? e.offers : e.offers ? [e.offers] : [];
      const prices = offers.map(function (o) { return o && (o.price != null ? o.price : o.lowPrice); })
        .filter(function (p) { return p !== undefined && p !== null && p !== ''; }).map(Number).filter(function (n) { return isFinite(n); });
      const price = !prices.length ? '' : Math.max.apply(null, prices) === 0 ? '免費'
        : 'NT$' + Math.min.apply(null, prices) + (Math.max.apply(null, prices) > Math.min.apply(null, prices) ? '～' + Math.max.apply(null, prices) : '');
      return {
        start: srcIsoToTaipei_(e.startDate), end: srcIsoToTaipei_(e.endDate),
        venue: srcDecode_(loc.name || ''), addr: srcDecode_(addr), price: price
      };
    }
  }
  return null;
}

/** 列表＋活動頁細節（details[id]，可缺）→ 場次列。只收實體活動。 */
function accupassRows_(items, details, from, toEx) {
  const rows = [];
  items.forEach(function (it) {
    if (!it.offline) return;
    const d = (details && details[it.id]) || null;
    const addr = d && d.addr ? d.addr.replace(/^台灣|^臺灣/, '') : '';
    let where = { city: it.city, approx: false };
    if (addr) { const w = srcCity_(addr, null); if (w.city || EV_CITY_RE_.test(addr)) where = w; }
    const r = srcRow_('accupass', {
      id: it.id, title: it.name, url: 'https://www.accupass.com/event/' + it.id,
      start: (d && d.start) || it.start, end: (d && d.end) || it.end, city: where.city, approx: where.approx,
      venue: d ? d.venue : '', addr: addr, price: d ? d.price : ''
    }, from, toEx);
    if (r) rows.push(r);
  });
  return srcSort_(rows);
}

// ── JOIN+1：活動 sitemap＋各活動頁 ──────────────────────────────────
function join1ParseSitemap_(xml) {
  const out = [];
  const re = /<loc>\s*(https:\/\/join1\.app\/event\/([A-Za-z0-9]+))\s*<\/loc>(?:\s*<lastmod>([^<]*)<\/lastmod>)?/g;
  let m;
  while ((m = re.exec(String(xml || '')))) out.push({ url: m[1], code: m[2], lastmod: m[3] || '' });
  return out;
}

/** 網頁 → 純文字片段（去掉 script／style／svg，每個標籤當分隔） */
function srcTextTokens_(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .split(/<[^>]+>/).map(function (t) { return srcDecode_(t).replace(/\s+/g, ' ').trim(); })
    .filter(function (t) { return t; });
}

/** "2026/11/27 週五 20:00" → "2026-11-27 20:00" */
function join1Time_(s) {
  const m = /(\d{4})\/(\d{1,2})\/(\d{1,2})[^0-9]*(\d{1,2}):(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const p2 = function (v) { return ('0' + v).slice(-2); };
  return m[1] + '-' + p2(m[2]) + '-' + p2(m[3]) + ' ' + p2(m[4]) + ':' + m[5];
}

/** 活動頁 → { title, start, end, addr, venue, price }；格式不符回 null */
function join1ParseEvent_(html) {
  const og = /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/.exec(String(html || ''));
  const title = og ? srcDecode_(og[1]).replace(/\s*[|｜-]\s*JOIN\+1.*$/i, '').trim() : '';
  const t = srcTextTokens_(html);
  const i = t.findIndex(function (x) { return /^開始\s*\|?$/.test(x); });
  if (!title || i < 0) return null;
  const start = join1Time_(t[i + 1]);
  if (!start) return null;
  let k = i + 2;
  let end = start;
  if (/^結束\s*\|?$/.test(t[k] || '')) { end = join1Time_(t[k + 1]) || start; k += 2; }
  const addr = t[k] || '';
  const venue = t[k + 1] || '';
  const fee = t[k + 2] || '';
  return {
    title: title, start: start, end: end, addr: addr, venue: venue,
    price: /收費|免費|\$|元|NT|費用|付費/.test(fee) && fee.length <= 40 ? fee : ''
  };
}

function join1Rows_(events, from, toEx) {
  const rows = [];
  events.forEach(function (e) {
    if (!e) return;
    const where = srcCity_(e.addr, null);
    const r = srcRow_('join1', {
      id: e.code, title: e.title, url: 'https://join1.app/event/' + e.code, start: e.start, end: e.end,
      city: where.city, approx: where.approx, venue: e.venue, addr: e.addr, price: e.price
    }, from, toEx);
    if (r) rows.push(r);
  });
  return srcSort_(rows);
}

// ── 合併：文化部為主，其他來源同標題＋同一天開始的視為同一場 ─────────────
function srcTitleKey_(t) {
  return String(t || '').toLowerCase().replace(/臺/g, '台')
    .replace(/[\s【】《》〈〉「」『』()（）\[\]!！?？、,，.。:：;；·・\-－—–_~～|｜/／…'"’‘“”#＃@＠&＆+＋]/g, '');
}

function evMergeRows_(primary, extras) {
  const seen = {};   // 標題＋日期 → 第一個出現的 uid（同一活動同一天的多個場次不互相去重）
  const key = function (r) { return srcTitleKey_(r.title) + '|' + r.start.slice(0, 10); };
  primary.forEach(function (r) { if (!seen[key(r)]) seen[key(r)] = r.uid; });
  const out = primary.slice();
  extras.forEach(function (r) {
    const k = key(r);
    if (seen[k] && seen[k] !== r.uid) return;
    seen[k] = r.uid;
    out.push(r);
  });
  return srcSort_(out);
}
