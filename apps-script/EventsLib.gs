/**
 * F3 活動與 LINE 推播的「純邏輯」：不呼叫任何 Apps Script 服務（UrlFetch、Sheets、Properties…），
 * 所以可以在 Node 用 tests/events.test.mjs 直接測試。會用到 Lib.gs 的 addDays_。
 *
 * 文化部資料（2026-11-24 實測）：
 *   showInfo[].time / endTime = "2026/11/25 14:30:00"（台北時間）；latitude/longitude 可能是 null；
 *   沒有縣市欄位，location 偶爾只寫「中正區…」；同一個 UID 可能出現兩次（不同類別）。
 */

const EV_SOURCE_ = 'moc';             // 去重鍵的 source 部分（之後補台北市資料時可分開）
const EV_MAX_TITLE_ = 120;
const EV_MAX_PRICE_ = 200;
const EV_MAX_TEXT_ = 300;

/** 已確認的類別代碼；其他代碼一律顯示「其他」 */
const EV_CATEGORIES_ = {
  '1': '音樂', '2': '戲劇', '3': '舞蹈', '4': '親子', '6': '展覽', '7': '講座', '8': '電影',
  '11': '綜藝', '13': '競賽', '14': '徵選', '17': '演唱會', '19': '研習課程', '200': '閱讀'
};

// 地址開頭的縣市（第一個出現的縣市為準）。台北縣是新北市舊名，不算台北。
const EV_CITY_RE_ = /(臺北市|台北市|桃園市|桃園縣|新北市|臺北縣|台北縣|基隆市|新竹市|新竹縣|苗栗縣|臺中市|台中市|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|臺南市|台南市|高雄市|屏東縣|宜蘭縣|花蓮縣|臺東縣|台東縣|澎湖縣|金門縣|連江縣)/;
// 「北市民生東路…」這種省略寫法
const EV_SHORT_TAIPEI_RE_ = /^\s*(\d{3,6}\s*)?北市/;
// 只寫行政區時：只有台北／桃園才有的區名
const EV_DISTRICTS_ = {
  '臺北': ['大同區', '松山區', '萬華區', '士林區', '北投區', '內湖區', '南港區', '文山區'],
  '桃園': ['桃園區', '中壢區', '平鎮區', '八德區', '楊梅區', '蘆竹區', '大溪區', '龍潭區', '龜山區', '大園區', '觀音區', '新屋區', '復興區']
};
// 別的縣市也有的台北區名（基隆有中正、中山、信義；台中有大安）：有座標時要落在台北範圍內
const EV_AMBIGUOUS_TAIPEI_ = ['中正區', '中山區', '信義區', '大安區'];
// 經緯度矩形（最後手段，只在地址完全看不出縣市時才用）
const EV_BOXES_ = {
  '臺北': { minLat: 24.96, maxLat: 25.21, minLng: 121.45, maxLng: 121.67 },
  '桃園': { minLat: 24.59, maxLat: 25.13, minLng: 120.97, maxLng: 121.48 }
};

/** "2026/11/25 14:30:00" → "2026-11-25 14:30"；格式不對回 null */
function evParseTime_(s) {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(s || '').trim());
  if (!m) return null;
  const p2 = function (v) { return ('0' + v).slice(-2); };
  return m[1] + '-' + p2(m[2]) + '-' + p2(m[3]) + ' ' + p2(m[4] || '0') + ':' + (m[5] || '00');
}

function evClean_(s, max) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** 只接受 http(s) 網址，避免 javascript: 之類的連結 */
function evUrl_(s) {
  const t = String(s || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(t) && t.length <= 500 ? t : '';
}

function evInBox_(box, lat, lng) {
  return lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;
}

/**
 * 判斷場次在哪個縣市。回傳 { city: '臺北' | '桃園' | null, approx: 是否為推測 }
 * 順序：地址裡的縣市 →「北市」簡寫 → 行政區名稱 → 經緯度。
 */
function evCityOf_(location, latitude, longitude) {
  const loc = String(location || '');
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  const hasLL = isFinite(lat) && isFinite(lng);

  const m = EV_CITY_RE_.exec(loc);
  if (m) {
    if (/^(臺|台)北市$/.test(m[1])) return { city: '臺北', approx: false };
    if (/^桃園/.test(m[1])) return { city: '桃園', approx: false };
    return { city: null, approx: false };   // 明確寫了別的縣市
  }
  if (EV_SHORT_TAIPEI_RE_.test(loc)) return { city: '臺北', approx: false };

  const head = loc.replace(/^\s*\d{3,6}\s*/, '').trim();
  const cities = Object.keys(EV_DISTRICTS_);
  for (let i = 0; i < cities.length; i++) {
    const list = EV_DISTRICTS_[cities[i]];
    for (let j = 0; j < list.length; j++) {
      if (head.indexOf(list[j]) === 0) return { city: cities[i], approx: true };
    }
  }
  for (let k = 0; k < EV_AMBIGUOUS_TAIPEI_.length; k++) {
    if (head.indexOf(EV_AMBIGUOUS_TAIPEI_[k]) === 0) {
      if (!hasLL || evInBox_(EV_BOXES_['臺北'], lat, lng)) return { city: '臺北', approx: true };
      return { city: null, approx: false };
    }
  }

  if (hasLL) {
    if (evInBox_(EV_BOXES_['臺北'], lat, lng)) return { city: '臺北', approx: true };
    if (evInBox_(EV_BOXES_['桃園'], lat, lng)) return { city: '桃園', approx: true };
  }
  return { city: null, approx: false };
}

/**
 * 原始資料 → 快取用的「場次列」（只留台北／桃園，且和 [fromYmd, toYmdExclusive) 有重疊的場次）。
 * 去重鍵：source + UID + 場次開始時間。
 */
function evToShowRows_(raw, fromYmd, toYmdExclusive) {
  const rows = [];
  const seen = {};
  (Array.isArray(raw) ? raw : []).forEach(function (ev) {
    if (!ev || typeof ev !== 'object' || !ev.UID) return;
    const uid = String(ev.UID).slice(0, 64);
    const title = evClean_(ev.title, EV_MAX_TITLE_);
    if (!title) return;
    const cat = String(ev.category || '');
    const url = evUrl_(ev.sourceWebPromote) || evUrl_(ev.webSales);
    const src = evClean_(ev.sourceWebName, 40);
    (Array.isArray(ev.showInfo) ? ev.showInfo : []).forEach(function (sh) {
      if (!sh) return;
      const start = evParseTime_(sh.time);
      if (!start) return;
      let end = evParseTime_(sh.endTime) || start;
      if (end < start) end = start;
      if (start.slice(0, 10) >= toYmdExclusive || end.slice(0, 10) < fromYmd) return;
      const where = evCityOf_(sh.location, sh.latitude, sh.longitude);
      if (!where.city) return;
      const key = EV_SOURCE_ + '|' + uid + '|' + start;
      if (seen[key]) return;
      seen[key] = true;
      rows.push({
        uid: uid, title: title, cat: cat, url: url, src: src,
        start: start, end: end, city: where.city, approx: where.approx,
        venue: evClean_(sh.locationName, 80),
        addr: evClean_(sh.location, 120),
        price: evClean_(sh.price, EV_MAX_PRICE_)
      });
    });
  });
  rows.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  return rows;
}

/** 0=日 … 6=六 */
function evWeekday_(ymd) {
  const p = ymd.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

/** "2026-12-06" → "12/6（六）" */
function evDayLabel_(ymd) {
  const p = ymd.split('-').map(Number);
  return p[1] + '/' + p[2] + '（' + '日一二三四五六'.charAt(evWeekday_(ymd)) + '）';
}

/**
 * 查詢 [startYmd, endYmdExclusive)：
 *   events：區間內有場次「開始」的活動，依第一個場次排序；shows 只列區間內的場次。
 *   ongoing：場次在區間前就開始、區間內仍在進行的活動（長期展覽），依結束日排序。
 */
function evSearch_(rows, startYmd, endYmdExclusive, maxEvents) {
  const byUid = {};
  const order = [];
  rows.forEach(function (r) {
    const sd = r.start.slice(0, 10);
    const ed = r.end.slice(0, 10);
    if (sd >= endYmdExclusive || ed < startYmd) return;
    let ev = byUid[r.uid];
    if (!ev) {
      ev = byUid[r.uid] = {
        uid: r.uid, title: r.title, cat: r.cat, catName: EV_CATEGORIES_[r.cat] || '其他',
        url: r.url, src: r.src, shows: [], spans: []
      };
      order.push(ev);
    }
    const show = { start: r.start, end: r.end, city: r.city, approx: !!r.approx, venue: r.venue, addr: r.addr, price: r.price };
    if (sd >= startYmd) ev.shows.push(show); else ev.spans.push(show);
  });

  const events = [];
  const ongoing = [];
  order.forEach(function (ev) {
    const spans = ev.spans;
    delete ev.spans;
    if (ev.shows.length) {
      ev.shows.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
      ev.first = ev.shows[0].start;
      events.push(ev);
    } else {
      spans.sort(function (a, b) { return a.end < b.end ? -1 : a.end > b.end ? 1 : 0; });
      ev.shows = spans;
      ev.until = spans[spans.length - 1].end.slice(0, 10);
      ongoing.push(ev);
    }
  });
  events.sort(function (a, b) { return a.first < b.first ? -1 : a.first > b.first ? 1 : 0; });
  ongoing.sort(function (a, b) { return a.until < b.until ? -1 : a.until > b.until ? 1 : 0; });

  const max = maxEvents || 300;
  return {
    total: events.length,
    ongoingTotal: ongoing.length,
    truncated: events.length > max || ongoing.length > max,
    events: events.slice(0, max),
    ongoing: ongoing.slice(0, max)
  };
}

/** 從 today（yyyy-MM-dd）算下週一～下週日：{ startDate, endDateExclusive }。週一執行時取下週一。 */
function evNextWeekFrom_(today) {
  const wd = evWeekday_(today);
  const toMon = ((8 - wd) % 7) || 7;
  const startDate = addDays_(today, toMon);
  return { startDate: startDate, endDateExclusive: addDays_(startDate, 7) };
}

function evByShowStart_(a, b) { return a.show.start < b.show.start ? -1 : a.show.start > b.show.start ? 1 : 0; }

/**
 * 推播時的挑選順序：先挑有週六／週日場次的活動，週六、週日輪流挑（避免 15 筆全被週六佔走），
 * 再依日期挑平日的活動。每筆附上代表場次 show（週末第一場，或第一場）與 weekend 旗標。
 */
function evWeekendFirst_(events) {
  const sat = [];
  const sun = [];
  const weekday = [];
  events.forEach(function (ev) {
    let w = null;
    for (let i = 0; i < ev.shows.length; i++) {
      const d = evWeekday_(ev.shows[i].start.slice(0, 10));
      if (d === 0 || d === 6) { w = ev.shows[i]; break; }
    }
    if (!w) weekday.push({ ev: ev, show: ev.shows[0], weekend: false });
    else (evWeekday_(w.start.slice(0, 10)) === 6 ? sat : sun).push({ ev: ev, show: w, weekend: true });
  });
  sat.sort(evByShowStart_);
  sun.sort(evByShowStart_);
  weekday.sort(evByShowStart_);
  const out = [];
  for (let i = 0; i < Math.max(sat.length, sun.length); i++) {
    if (i < sat.length) out.push(sat[i]);
    if (i < sun.length) out.push(sun[i]);
  }
  return out.concat(weekday);
}

/** "2026-12-06 14:30" → "12/6（六）14:30"；00:00 視為沒寫時間 */
function evWhen_(start) {
  const t = start.slice(11);
  return evDayLabel_(start.slice(0, 10)) + (t && t !== '00:00' ? t : '');
}

/**
 * 週五推播文字（1 則文字訊息）。最多 maxItems 筆，總長 ≤ maxLen 個 UTF-16 code unit；
 * 放不下或超過筆數的部分改成「其餘 N 個活動請開 App 查看」。
 */
function evWeeklyText_(result, range, opts) {
  const o = opts || {};
  const maxItems = o.maxItems || 15;
  const maxLen = o.maxLen || 3500;
  const appUrl = o.appUrl || '';
  const lastDay = addDays_(range.endDateExclusive, -1);
  const head = '📅 下週台北／桃園藝文活動\n' + evDayLabel_(range.startDate) + '–' + evDayLabel_(lastDay) +
    '，共 ' + result.total + ' 個' + (result.total > 1 ? '（週末優先）' : '') + '\n';

  if (!result.total) {
    return head + '\n下週沒有找到活動。' + (result.ongoingTotal ? '\n另有 ' + result.ongoingTotal + ' 個長期展覽或課程進行中。' : '') +
      (appUrl ? '\n' + appUrl : '');
  }

  const items = evWeekendFirst_(result.events);
  const footFor = function (rest) {
    let f = '';
    if (rest > 0) f += '\n其餘 ' + rest + ' 個活動請開 App 查看';
    if (result.ongoingTotal) f += '\n另有 ' + result.ongoingTotal + ' 個長期展覽或課程進行中';
    if (appUrl) f += '\n' + appUrl;
    return f;
  };
  // 編號前的內容；長度預估一律用兩位數編號，排序後重新編號也不會超過上限
  const body = function (it) {
    const ev = it.ev;
    const sh = it.show;
    const more = ev.shows.length > 1 ? ' 等 ' + ev.shows.length + ' 場' : '';
    let b = evWhen_(sh.start) + more + '\n' + ev.title +
      '\n📍 ' + (sh.venue || sh.addr || '地點未提供') + '｜' + (sh.city === '臺北' ? '台北' : sh.city);
    if (ev.url) b += '\n🔗 ' + ev.url;
    return b + '\n';
  };

  const picked = [];
  let used = head.length;
  for (let i = 0; i < items.length && picked.length < maxItems; i++) {
    const len = '\n00. '.length + body(items[i]).length;
    if (used + len + footFor(items.length - picked.length - 1).length > maxLen) break;
    picked.push(items[i]);
    used += len;
  }
  // 顯示順序：週末的依時間，再接平日的依時間
  picked.sort(function (a, b) { return a.weekend !== b.weekend ? (a.weekend ? -1 : 1) : evByShowStart_(a, b); });
  const lines = picked.map(function (it, i) { return '\n' + (i + 1) + '. ' + body(it); });
  return head + lines.join('') + footFor(items.length - picked.length);
}

/**
 * LINE 推播前的判斷（pushLine_ 用）。logRows：push_log 的紀錄
 *   [{ ts: 毫秒, ymd: 'yyyy-MM-dd', eventId, status: 'pending'|'sent'|'failed', retryKey }]
 * 回傳 { go: true, retryKey: 可重用的 key 或 null } 或 { go: false, reason: 'DUP'|'DAILY_LIMIT'|'MONTHLY_LIMIT' }
 * 規則：同 eventId 已 sent → 不送；pending（結果不明）也算進用量；
 *       同 eventId 在 23 小時內有 pending／failed 紀錄 → 重用它的 retry key（LINE 會回 409 代表先前已送達）。
 */
function linePushPlan_(logRows, eventId, nowMs, todayYmd, limits) {
  const month = todayYmd.slice(0, 7);
  let today = 0;
  let thisMonth = 0;
  let reuse = null;
  for (let i = 0; i < logRows.length; i++) {
    const r = logRows[i];
    if (r.eventId === eventId && r.status === 'sent') return { go: false, reason: 'DUP' };
    if (r.status === 'sent' || r.status === 'pending') {
      if (r.ymd === todayYmd) today++;
      if (String(r.ymd).slice(0, 7) === month) thisMonth++;
    }
    if (r.eventId === eventId && r.retryKey && (r.status === 'pending' || r.status === 'failed') &&
        nowMs - r.ts < 23 * 3600 * 1000) {
      reuse = r.retryKey;
    }
  }
  if (thisMonth >= limits.monthly) return { go: false, reason: 'MONTHLY_LIMIT' };
  if (today >= limits.daily) return { go: false, reason: 'DAILY_LIMIT' };
  return { go: true, retryKey: reuse };
}

// ── 活動偏好：左滑移除（hidden）與收藏（fav） ──────────────────────────

const EV_UID_RE_ = /^[A-Za-z0-9_\-]{1,64}$/;
const EV_SNAPSHOT_SHOWS_ = 10;
const EV_TIME_RE_ = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/**
 * 收藏時前端送來的活動資料 → 清理過的快照（收藏的活動過期或超出快取範圍時，收藏頁用它顯示）。
 * 格式不對回 null。場次最多留 10 個，縣市只接受臺北／桃園。
 */
function evSnapshot_(ev) {
  if (!ev || typeof ev !== 'object' || !EV_UID_RE_.test(String(ev.uid || ''))) return null;
  const title = evClean_(ev.title, EV_MAX_TITLE_);
  if (!title) return null;
  const shows = (Array.isArray(ev.shows) ? ev.shows : []).slice(0, EV_SNAPSHOT_SHOWS_).map(function (s) {
    if (!s || !EV_TIME_RE_.test(String(s.start))) return null;
    const city = s.city === '臺北' || s.city === '桃園' ? s.city : null;
    if (!city) return null;
    let end = EV_TIME_RE_.test(String(s.end)) ? s.end : s.start;
    if (end < s.start) end = s.start;
    return {
      start: s.start, end: end, city: city, approx: !!s.approx,
      venue: evClean_(s.venue, 80), addr: evClean_(s.addr, 120), price: evClean_(s.price, EV_MAX_PRICE_)
    };
  }).filter(Boolean);
  if (!shows.length) return null;
  const cat = String(ev.cat || '').slice(0, 8);
  return {
    uid: String(ev.uid), title: title, cat: cat, catName: EV_CATEGORIES_[cat] || evClean_(ev.catName, 10) || '其他',
    url: evUrl_(ev.url), src: evClean_(ev.src, 40), shows: shows
  };
}

/** 從場次列拿掉指定 UID（已移除的活動不出現在查詢與週五推播） */
function evExcludeUids_(rows, uidMap) {
  return rows.filter(function (r) { return !uidMap[r.uid]; });
}

/**
 * 收藏清單：優先用今天的快取（今天以後的場次），快取沒有時用收藏時的快照。
 * favs：[{ uid, at, title, snap }]。回傳依下一場排序的活動，結束的排在最後（ended: true）。
 */
function evFavList_(favs, rows, today) {
  const byUid = {};
  rows.forEach(function (r) {
    if (r.end.slice(0, 10) >= today) (byUid[r.uid] = byUid[r.uid] || []).push(r);
  });
  const out = favs.map(function (f) {
    const cur = byUid[f.uid];
    let ev;
    if (cur && cur.length) {
      const r0 = cur[0];
      ev = {
        uid: f.uid, title: r0.title, cat: r0.cat, catName: EV_CATEGORIES_[r0.cat] || '其他', url: r0.url, src: r0.src,
        shows: cur.map(function (r) {
          return { start: r.start, end: r.end, city: r.city, approx: !!r.approx, venue: r.venue, addr: r.addr, price: r.price };
        })
      };
    } else if (f.snap) {
      ev = JSON.parse(JSON.stringify(f.snap));
    } else {
      ev = { uid: f.uid, title: f.title || '（活動）', cat: '', catName: '其他', url: '', src: '', shows: [] };
    }
    const upcoming = ev.shows.filter(function (s) { return s.end.slice(0, 10) >= today; });
    ev.ended = upcoming.length === 0;
    if (!ev.ended) ev.shows = upcoming;
    ev.favAt = f.at || '';
    return ev;
  });
  const next = function (ev) { return ev.shows.length ? ev.shows[0].start : ''; };
  out.sort(function (a, b) {
    if (a.ended !== b.ended) return a.ended ? 1 : -1;
    if (!a.ended) return next(a) < next(b) ? -1 : next(a) > next(b) ? 1 : 0;
    return a.favAt > b.favAt ? -1 : a.favAt < b.favAt ? 1 : 0;
  });
  return out;
}
