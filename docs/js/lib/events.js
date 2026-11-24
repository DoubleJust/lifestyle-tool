// 活動頁的純邏輯：日期區間、標籤文字、篩選與分組。不碰 DOM，tests/events-ui.test.mjs 直接測試。
// 日期一律是台北時間的 yyyy-MM-dd 字串，區間為半開區間 [start, endExclusive)。

const WD = '日一二三四五六';

export function todayTaipei(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now);
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0=日 … 6=六 */
export function weekday(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "2026-12-05" → "12/5（六）" */
export function dayLabel(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}/${d}（${WD[weekday(ymd)]}）`;
}

export const PRESETS = [
  { id: 'thisweek', name: '本週' },
  { id: 'nextweek', name: '下週' },
  { id: 'next30', name: '未來 30 天' },
  { id: 'custom', name: '自訂' }
];

export const DAYS = [
  { id: 'all', name: '不限' },
  { id: 'weekday', name: '平日' },
  { id: 'weekend', name: '週末' }
];

export const EVENING_FROM = '19:00';   // 「晚上」：開始時間 19:00 以後

/** 快速選擇 → { start, endExclusive }；custom 回 null */
export function presetRange(id, today) {
  const toNextMon = ((8 - weekday(today)) % 7) || 7;   // 週日 → 1，週一 → 7
  switch (id) {
    case 'thisweek': return { start: today, endExclusive: addDays(today, toNextMon) };
    case 'nextweek': {
      const mon = addDays(today, toNextMon);
      return { start: mon, endExclusive: addDays(mon, 7) };
    }
    case 'next30': return { start: today, endExclusive: addDays(today, 30) };
    default: return null;
  }
}

/** 自訂日期（結束日含當天）的檢查，對應後端限制：起日在今天～60 天後，最長 31 天 */
export function customRange(start, endInclusive, today) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (!ok(start) || !ok(endInclusive)) return { error: '請選擇開始與結束日期。' };
  if (start < today) return { error: '開始日期不能早於今天。' };
  if (start > addDays(today, 60)) return { error: '開始日期最晚只能選 60 天後。' };
  if (endInclusive < start) return { error: '結束日期不能早於開始日期。' };
  const endExclusive = addDays(endInclusive, 1);
  if (endExclusive > addDays(start, 31)) return { error: '一次最多查 31 天。' };
  return { start, endExclusive };
}

/** { start, endExclusive } → "11/30（一）–12/6（日）"；單日只顯示一天 */
export function rangeLabel(r) {
  const last = addDays(r.endExclusive, -1);
  return last === r.start ? dayLabel(r.start) : `${dayLabel(r.start)}–${dayLabel(last)}`;
}

/**
 * 場次時間文字：
 *   同一天 → "14:30–16:00"（結束等於開始時只寫開始；00:00 視為沒寫時間）
 *   跨日   → "12/12（六）11:00 – 12/27（日）19:00"
 */
export function showTime(show, withDay = false) {
  const sd = show.start.slice(0, 10), st = show.start.slice(11);
  const ed = show.end.slice(0, 10), et = show.end.slice(11);
  const t = (x) => (x && x !== '00:00' ? x : '');
  if (sd !== ed) {
    return `${dayLabel(sd)}${t(st) ? ' ' + st : ''} – ${dayLabel(ed)}${t(et) ? ' ' + et : ''}`;
  }
  let time = t(st) ? (t(et) && et !== st ? `${st}–${et}` : st) : '時間未提供';
  return withDay ? `${dayLabel(sd)} ${time}` : time;
}

export const cityName = (c) => (c === '臺北' ? '台北' : c);

/**
 * 場次是否符合日子與時段：
 *   days：'all' | 'weekday' | 'weekend'。跨日的場次（例如展覽）只要在區間內有一天符合就算。
 *   evening：開始時間 19:00 以後才算；沒寫時間（00:00）的不算。
 */
export function showMatches(show, { days = 'all', evening = false } = {}, range = null) {
  if (evening && !(show.start.slice(11) >= EVENING_FROM)) return false;
  if (days === 'all') return true;
  let d = show.start.slice(0, 10);
  let last = show.end.slice(0, 10);
  if (range) {
    if (d < range.start) d = range.start;
    const rangeLast = addDays(range.endExclusive, -1);
    if (last > rangeLast) last = rangeLast;
  }
  for (let i = 0; d <= last && i < 31; i++, d = addDays(d, 1)) {
    const wd = weekday(d);
    if ((days === 'weekend') === (wd === 0 || wd === 6)) return true;
  }
  return false;
}

/**
 * 篩選後端結果。f = { city: 'all'|'臺北'|'桃園', days, evening, cat: 'all'|類別名稱, hidden: Set<uid> }
 * 縣市、日子、時段以場次為單位：只留符合的場次，沒有場次的活動就拿掉。
 * 回傳 { events, ongoing, cats: [{ name, count }], total }：
 *   cats 與 total 是類別篩選前的數量，且只算區間內開演的活動（和摘要的「共 N 個活動」一致）。
 */
export function filterEvents(data, { city = 'all', days = 'all', evening = false, cat = 'all', hidden = null } = {}) {
  const range = data.range || null;
  const keep = (ev) => {
    if (hidden && hidden.has(ev.uid)) return null;
    const shows = ev.shows.filter((s) => (city === 'all' || s.city === city) && showMatches(s, { days, evening }, range));
    return shows.length ? { ...ev, shows } : null;
  };
  // 篩掉場次後，第一場可能變晚，要重新排序
  const events = (data.events || []).map(keep).filter(Boolean)
    .sort((a, b) => (a.shows[0].start < b.shows[0].start ? -1 : a.shows[0].start > b.shows[0].start ? 1 : 0));
  const ongoing = (data.ongoing || []).map(keep).filter(Boolean);
  const counts = new Map();
  for (const ev of ongoing) counts.set(ev.catName, 0);
  for (const ev of events) counts.set(ev.catName, (counts.get(ev.catName) || 0) + 1);
  const cats = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const byCat = (ev) => cat === 'all' || ev.catName === cat;
  return { events: events.filter(byCat), ongoing: ongoing.filter(byCat), cats, total: events.length };
}

/** 依第一個場次的日期分組：[{ day: 'yyyy-MM-dd', events: [...] }]，保持原本的時間順序 */
export function groupByDay(events) {
  const groups = [];
  for (const ev of events) {
    const day = ev.shows[0].start.slice(0, 10);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) groups.push(g = { day, events: [] });
    g.events.push(ev);
  }
  return groups;
}

/** 只接受 http(s) 連結（後端已檢查，前端再擋一次） */
export function safeUrl(u) {
  return typeof u === 'string' && /^https?:\/\/\S+$/i.test(u) ? u : '';
}
