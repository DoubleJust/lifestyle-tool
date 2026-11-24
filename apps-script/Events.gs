/** F3 台北／桃園活動：抓文化部資料、每日快取、手動查詢、週五推播 */

const EV_API_URL_ = 'https://cloud.culture.tw/frontsite/trans/SearchShowAction.do?method=doFindTypeJ&category=all';
const EV_CACHE_DAYS_ = 92;          // 快取今天起 92 天內的場次
const EV_MAX_RANGE_DAYS_ = 31;      // 查詢區間最長 31 天
const EV_MAX_START_AHEAD_ = 60;     // 起日最晚 60 天後
const EV_APP_URL_ = 'https://doublejust.github.io/lifestyle-tool/#events';
const EV_PREFS_MAX_ = 2000;         // event_prefs 最多幾筆（移除＋收藏）

/** action events.search：{ start: 'yyyy-MM-dd', endExclusive: 'yyyy-MM-dd' } */
function eventsSearch_(params) {
  const start = evDateParam_(params.start, 'start');
  const endEx = evDateParam_(params.endExclusive, 'endExclusive');
  const today = ymd_(new Date());
  if (start < today || start > addDays_(today, EV_MAX_START_AHEAD_)) throw inputError_('start');
  if (endEx <= start || endEx > addDays_(start, EV_MAX_RANGE_DAYS_)) throw inputError_('endExclusive');

  const data = evLoadRows_({ allowStale: true });
  const prefs = evReadPrefs_();
  const hidden = evPrefMap_(prefs, 'hidden');
  const r = evSearch_(evExcludeUids_(data.rows, hidden), start, endEx, 300);
  const hiddenHere = evSearch_(data.rows.filter(function (x) { return hidden[x.uid]; }), start, endEx, 1);
  r.hiddenCount = hiddenHere.total + hiddenHere.ongoingTotal;
  r.favUids = prefs.filter(function (p) { return p.state === 'fav'; }).map(function (p) { return p.uid; });
  r.range = { start: start, endExclusive: endEx };
  r.fetched = data.fetched;
  r.stale = data.stale;
  return r;
}

function evDateParam_(v, field) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || addDays_(v, 0) !== v) throw inputError_(field);
  return v;
}

/** 排程：每週五 18 點推播下週活動。同一週重複執行只會推一次（pushLine_ 依 eventId 去重）。 */
function weeklyEventsJob() {
  runJob_('weeklyEventsJob', function () {
    const range = nextWeekRange_();
    const data = evLoadRows_({ locked: true, allowStale: false });
    const rows = evExcludeUids_(data.rows, evPrefMap_(evReadPrefs_(), 'hidden'));
    const r = evSearch_(rows, range.startDate, range.endDateExclusive, 1000);
    const text = evWeeklyText_(r, range, { appUrl: EV_APP_URL_ });
    const res = pushLine_(text, 'events-weekly:' + range.startDate);
    return 'week=' + range.startDate + ' events=' + r.total + ' ongoing=' + r.ongoingTotal +
      ' push=' + res.status + (res.reason ? '/' + res.reason : '');
  });
}

/** 手動執行：只在執行記錄印出下週的推播內容，不會推播 */
function previewWeeklyEvents() {
  const range = nextWeekRange_();
  const data = evLoadRows_({ allowStale: false });
  const r = evSearch_(evExcludeUids_(data.rows, evPrefMap_(evReadPrefs_(), 'hidden')), range.startDate, range.endDateExclusive, 1000);
  const text = evWeeklyText_(r, range, { appUrl: EV_APP_URL_ });
  console.log('長度 ' + text.length + '\n' + text);
}

/**
 * 取得快取的場次列；今天還沒更新就重新抓文化部資料。
 * opts.locked：呼叫端已持有 script lock（排程工作）；opts.allowStale：抓取失敗時可用舊快取（手動查詢）。
 * 回傳 { rows, fetched: 資料日期, stale: 是否為舊資料 }
 */
function evLoadRows_(opts) {
  const o = opts || {};
  const props = PropertiesService.getScriptProperties();
  const today = ymd_(new Date());
  if (props.getProperty('EV_CACHE_DATE') === today) return { rows: evReadCache_(), fetched: today, stale: false };

  const lock = o.locked ? null : LockService.getScriptLock();
  if (lock && !lock.tryLock(20000)) {
    const cached = props.getProperty('EV_CACHE_DATE');
    if (cached && o.allowStale) return { rows: evReadCache_(), fetched: cached, stale: true };
    throw busyError_();
  }
  try {
    if (props.getProperty('EV_CACHE_DATE') === today) return { rows: evReadCache_(), fetched: today, stale: false };
    try {
      const t0 = Date.now();
      const rows = evToShowRows_(evFetchRaw_(), today, addDays_(today, EV_CACHE_DAYS_));
      evWriteCache_(today, rows);
      props.setProperty('EV_CACHE_DATE', today);
      writeLog_('events.refresh', 'OK rows=' + rows.length, Date.now() - t0);
      return { rows: rows, fetched: today, stale: false };
    } catch (e) {
      const cached = props.getProperty('EV_CACHE_DATE');
      if (cached && o.allowStale) {
        writeLog_('events.refresh', 'ERROR（改用 ' + cached + ' 的快取）' + sanitize_(String(e && e.message || e)).slice(0, 200), 0);
        return { rows: evReadCache_(), fetched: cached, stale: true };
      }
      throw e;
    }
  } finally {
    if (lock) lock.releaseLock();
  }
}

function evFetchRaw_() {
  const res = UrlFetchApp.fetch(EV_API_URL_, { muteHttpExceptions: true, followRedirects: true });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('culture API HTTP ' + code);
  let data;
  try { data = JSON.parse(res.getContentText('UTF-8')); } catch (e) { throw new Error('culture API bad JSON'); }
  if (!Array.isArray(data) || !data.length) throw new Error('culture API empty');
  return data;
}

/** events_cache：A 抓取日期、B 開始時間（給人看）、C 場次 JSON（程式讀）。整張覆寫。 */
function evWriteCache_(today, rows) {
  const sh = getSheet_('events_cache');
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  if (!rows.length) return;
  const need = rows.length + 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  const range = sh.getRange(2, 1, rows.length, 3);
  range.setNumberFormat('@');   // 純文字，避免日期或「=」開頭的標題被試算表轉換
  range.setValues(rows.map(function (r) { return [today, r.start, JSON.stringify(r)]; }));
}

function evReadCache_() {
  const sh = getSheet_('events_cache');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 3, last - 1, 1).getValues()
    .map(function (row) { try { return JSON.parse(row[0]); } catch (e) { return null; } })
    .filter(function (r) { return r && r.uid && r.start; });
}

// ── 活動偏好（event_prefs）：A uid、B 狀態 hidden|fav、C 日期、D 標題、E 收藏時的快照 JSON ──

function evReadPrefs_() {
  const sh = getSheet_('event_prefs');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 5).getValues().map(function (v, i) {
    let snap = null;
    if (v[4]) { try { snap = JSON.parse(v[4]); } catch (e) { snap = null; } }
    return {
      row: i + 2, uid: String(v[0]).trim(), state: String(v[1]).trim(),
      at: v[2] instanceof Date ? ymd_(v[2]) : String(v[2]).slice(0, 10), title: String(v[3]), snap: snap
    };
  }).filter(function (p) { return EV_UID_RE_.test(p.uid) && (p.state === 'hidden' || p.state === 'fav'); });
}

function evPrefMap_(prefs, state) {
  const m = {};
  prefs.forEach(function (p) { if (p.state === state) m[p.uid] = true; });
  return m;
}

/** action events.setPref：{ uid, state: 'hidden'|'fav'|'none', title?, ev?（收藏時必填） } */
function eventsSetPref_(params) {
  const uid = String(params.uid || '');
  if (!EV_UID_RE_.test(uid)) throw inputError_('uid');
  const state = params.state;
  if (state !== 'hidden' && state !== 'fav' && state !== 'none') throw inputError_('state');
  let snap = null;
  if (state === 'fav') {
    snap = evSnapshot_(params.ev);
    if (!snap || snap.uid !== uid) throw inputError_('ev');
  }
  const title = snap ? snap.title : evClean_(params.title, EV_MAX_TITLE_);

  // 使用者鎖：和排程工作的 script lock 分開，週五推播執行中也能操作
  const lock = LockService.getUserLock();
  if (!lock.tryLock(10000)) throw busyError_();
  try {
    const sh = getSheet_('event_prefs');
    const prefs = evReadPrefs_();
    const cur = prefs.filter(function (p) { return p.uid === uid; });
    if (state === 'none') {
      cur.map(function (p) { return p.row; }).sort(function (a, b) { return b - a; })
        .forEach(function (row) { sh.deleteRow(row); });
      return { uid: uid, state: 'none' };
    }
    const values = [[uid, state, ymd_(new Date()), title, snap ? JSON.stringify(snap) : '']];
    let row;
    if (cur.length) {
      row = cur[0].row;
    } else {
      if (prefs.length >= EV_PREFS_MAX_) throw inputError_('full');
      row = sh.getLastRow() + 1;
      if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
    }
    sh.getRange(row, 1, 1, 5).setNumberFormat('@').setValues(values);   // 純文字，避免「=」開頭的標題被當成公式
    return { uid: uid, state: state };
  } finally {
    lock.releaseLock();
  }
}

/** action events.prefs：收藏清單（含最新場次）與已移除清單 */
function eventsPrefs_() {
  const prefs = evReadPrefs_();
  const today = ymd_(new Date());
  const favs = prefs.filter(function (p) { return p.state === 'fav'; });
  let rows = [];
  let fetched = null;
  if (favs.length) {
    try {
      const d = evLoadRows_({ allowStale: true });
      rows = d.rows;
      fetched = d.fetched;
    } catch (e) {
      rows = [];   // 抓不到最新資料時改用收藏時的快照
    }
  }
  return {
    favs: evFavList_(favs, rows, today),
    hidden: prefs.filter(function (p) { return p.state === 'hidden'; })
      .map(function (p) { return { uid: p.uid, title: p.title, at: p.at }; }).reverse(),
    fetched: fetched
  };
}
