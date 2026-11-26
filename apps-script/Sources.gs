/**
 * 其他活動來源的抓取與快取（解析在 SourcesLib.gs）。由 dailyHealthJob 每天抓一次，
 * 結果存在試算表 extra_cache；查詢與週五推播把它和文化部的資料合併（evAllRows_）。
 * 某個來源失敗時保留它上一次成功的資料，並在 HEALTH 記為異常（App 會改顯示「到網站找」的連結）。
 */

const EXTRA_SOURCES_ = ['taipei', 'tycg', 'accupass', 'join1'];
const SRC_MAX_PAGES_ = { accupass: 60, join1: 200 };   // 每天最多抓幾個活動頁

function srcFetch_(url, extraHeaders) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: extraHeaders || {} });
  const code = res.getResponseCode();
  const text = res.getContentText('UTF-8');
  if (code !== 200) {
    throw new Error('HTTP ' + code + (/Just a moment|challenge-platform|cf-chl/i.test(text) ? '（被 Cloudflare 擋下）' : ''));
  }
  return text;
}

/** 一次抓多個網址（每批 batch 個），失敗的回 null */
function srcFetchAll_(urls, batch) {
  const out = [];
  for (let i = 0; i < urls.length; i += batch) {
    const reqs = urls.slice(i, i + batch).map(function (u) { return { url: u, muteHttpExceptions: true, followRedirects: true }; });
    let res;
    try { res = UrlFetchApp.fetchAll(reqs); } catch (e) { res = reqs.map(function () { return null; }); }
    res.forEach(function (r) { out.push(r && r.getResponseCode() === 200 ? r.getContentText('UTF-8') : null); });
  }
  return out;
}

/** 各來源的抓取：回傳 { parsed, rows, note } */
const SRC_FETCHERS_ = {
  taipei: function (from, toEx) {
    const text = srcFetch_('https://www.travel.taipei/api/zh-tw/event/season',
      { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' });
    const r = taipeiParse_(text, from, toEx);
    r.note = 'items=' + r.parsed;
    return r;
  },
  tycg: function (from, toEx) {
    const r = tycgParse_(srcFetch_('https://opendata.tycg.gov.tw/api/dataset/b7998dff-8c65-428a-b9b9-a2e9e13fdfb3/resource/5ae41ecf-1ea0-420d-acbf-90c59cedf999/download'), from, toEx);
    r.note = 'items=' + r.parsed;
    return r;
  },
  accupass: function (from, toEx) {
    const items = accupassParseList_(srcFetch_('https://www.accupass.com/?area=north'));
    const wanted = items.filter(function (it) {
      return it.offline && it.city && it.start && it.start.slice(0, 10) < toEx && (it.end || it.start).slice(0, 10) >= from;
    }).slice(0, SRC_MAX_PAGES_.accupass);
    const pages = srcFetchAll_(wanted.map(function (it) { return 'https://www.accupass.com/event/' + it.id; }), 10);
    const details = {};
    let ok = 0;
    wanted.forEach(function (it, i) { const d = pages[i] ? srcLdEvent_(pages[i]) : null; if (d) { details[it.id] = d; ok++; } });
    return { parsed: items.length, rows: accupassRows_(items, details, from, toEx), note: 'list=' + items.length + ' pages=' + ok + '/' + wanted.length };
  },
  join1: function (from, toEx) {
    const urls = join1ParseSitemap_(srcFetch_('https://join1.app/sitemap/events.xml')).slice(0, SRC_MAX_PAGES_.join1);
    if (!urls.length) return { parsed: 0, rows: [], note: 'sitemap 沒有活動' };
    const pages = srcFetchAll_(urls.map(function (u) { return u.url; }), 20);
    const events = [];
    urls.forEach(function (u, i) {
      const e = pages[i] ? join1ParseEvent_(pages[i]) : null;
      if (e) { e.code = u.code; events.push(e); }
    });
    return { parsed: events.length, rows: join1Rows_(events, from, toEx), note: 'pages=' + events.length + '/' + urls.length };
  }
};

/** 抓所有其他來源（dailyHealthJob 呼叫）。回傳摘要字串。各來源互不影響。 */
function refreshExtraSources_() {
  const today = ymd_(new Date());
  const toEx = addDays_(today, EV_CACHE_DAYS_);
  const notes = [];
  EXTRA_SOURCES_.forEach(function (key) {
    try {
      const r = SRC_FETCHERS_[key](today, toEx);
      if (!r.parsed) throw new Error('解析不到任何活動（網頁可能改版）' + (r.note ? '：' + r.note : ''));
      srcWriteCache_(key, today, r.rows);
      healthMark_(key, true);
      notes.push(key + ' ok ' + r.rows.length + ' (' + r.note + ')');
    } catch (e) {
      const msg = String(e && e.message || e);
      healthMark_(key, false, msg);
      notes.push(key + ' FAIL ' + sanitize_(msg).slice(0, 80));
    }
  });
  return notes.join('; ');
}

/** extra_cache：A 來源、B 抓取日期、C 開始、D 場次 JSON。更新某個來源時只換掉那個來源的列。 */
function srcWriteCache_(key, today, rows) {
  const sh = getSheet_('extra_cache');
  const last = sh.getLastRow();
  const keep = last > 1 ? sh.getRange(2, 1, last - 1, 4).getValues().filter(function (v) { return String(v[0]) !== key && v[0] !== ''; }) : [];
  const values = keep.concat(rows.map(function (r) { return [key, today, r.start, JSON.stringify(r)]; }));
  if (last > 1) sh.getRange(2, 1, last - 1, 4).clearContent();
  if (!values.length) return;
  const need = values.length + 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  sh.getRange(2, 1, values.length, 4).setNumberFormat('@').setValues(values);
}

/** 其他來源今天以後的場次 */
function srcReadCache_(today) {
  const sh = getSheet_('extra_cache');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 4, last - 1, 1).getValues()
    .map(function (v) { try { return JSON.parse(v[0]); } catch (e) { return null; } })
    .filter(function (r) { return r && r.uid && r.start && String(r.end || r.start).slice(0, 10) >= today; });
}

/** 文化部＋其他來源合併後的場次列（查詢、推播、收藏、清理都用這個） */
function evAllRows_(opts) {
  const data = evLoadRows_(opts);
  let extra = [];
  try { extra = srcReadCache_(ymd_(new Date())); } catch (e) { extra = []; }
  return { rows: evMergeRows_(data.rows, extra), fetched: data.fetched, stale: data.stale };
}
