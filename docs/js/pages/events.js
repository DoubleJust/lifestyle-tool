// F3 台北／桃園活動：期間＋日子＋時段＋地區 → 後端 events.search（文化部藝文活動，每日快取）→ 依日期分組顯示。
// 左滑（或按「移除」）把活動移除，之後不再出現；「☆ 收藏」的活動在上方「收藏」查看。兩者都存在後端 event_prefs。
// 外部資料一律經 h() 用 textContent 顯示；連結只接受 http(s)。
import { h, card, setStatus } from '../ui.js';
import { call, ApiError } from '../api.js';
import { get, set } from '../store.js';
import {
  PRESETS, DAYS, presetRange, customRange, rangeLabel, dayLabel, weekday, showTime, cityName,
  filterEvents, groupByDay, safeUrl, todayTaipei, addDays
} from '../lib/events.js';

const CITIES = [{ id: 'all', name: '全部' }, { id: '臺北', name: '台北' }, { id: '桃園', name: '桃園' }];
const MAX_SHOW_TAGS = 8;           // 多場次時最多列幾個場次
const SNAPSHOT_SHOWS = 10;         // 收藏時送給後端的場次數（後端也限制 10）
const SEARCH_TIMEOUT_MS = 40000;   // 每天第一次查詢要下載整份文化部資料，給長一點
const UNDO_MS = 6000;

// 本次開啟 App 期間保留：切換分頁回來不用重查
const cache = new Map();                                  // `${start}|${endExclusive}` → 後端結果
const prefs = { favs: new Set(), hidden: new Set() };     // 以後端為準，操作時先樂觀更新

let toastEl = null;
let toastTimer = 0;

const pick = (key, list, fallback) => {
  const v = get(key, fallback);
  return list.some((x) => x.id === v) ? v : fallback;
};

/**
 * @param {HTMLElement} view
 * @param {{ api?: (action, params, opts) => Promise<any>, today?: string }} opts 樣板頁可替換資料來源
 */
export function mount(view, opts = {}) {
  const api = opts.api || call;
  const today = opts.today || todayTaipei();

  let mode = get('events.mode', 'search') === 'favs' ? 'favs' : 'search';
  let preset = pick('events.preset', PRESETS, 'thisweek');
  let days = pick('events.days', DAYS, 'all');
  let evening = get('events.evening', '0') === '1';
  let city = pick('events.city', CITIES, 'all');
  let cat = 'all';
  let data = null;
  let seq = 0;

  // ── 上方切換：找活動｜收藏 ──
  const modeSearch = h('button', { type: 'button', class: 'chip', onclick: () => setMode('search') }, '找活動');
  const modeFavs = h('button', { type: 'button', class: 'chip', onclick: () => setMode('favs') }, '★ 收藏');
  const modeRow = h('div', { class: 'chips ev-mode', role: 'group', 'aria-label': '顯示' }, modeSearch, modeFavs);

  // ── 篩選 ──
  const chipGroup = (label, list, onPick) => list.map((x) => h('button', {
    type: 'button', class: 'chip', 'data-id': x.id, onclick: () => onPick(x.id)
  }, x.name));
  const presetBtns = chipGroup('期間', PRESETS, (id) => {
    preset = id; set('events.preset', id); sync(); if (id !== 'custom') run();
  });
  const dayBtns = chipGroup('日子', DAYS, (id) => { days = id; set('events.days', id); cat = 'all'; sync(); render(); });
  const eveningBtn = h('button', { type: 'button', class: 'chip', onclick: () => {
    evening = !evening; set('events.evening', evening ? '1' : '0'); cat = 'all'; sync(); render();
  } }, '🌙 晚上');
  const cityBtns = chipGroup('地區', CITIES, (id) => { city = id; set('events.city', id); cat = 'all'; sync(); render(); });

  const startInput = h('input', { id: 'ev-start', type: 'date', min: today, max: addDays(today, 60), value: today });
  const endInput = h('input', { id: 'ev-end', type: 'date', min: today, max: addDays(today, 90), value: addDays(today, 6) });
  startInput.addEventListener('change', () => { endInput.min = startInput.value || today; });
  const custom = h('div', { class: 'ev-custom' },
    h('div', { class: 'grid2' },
      h('div', {}, h('label', { for: 'ev-start' }, '開始'), startInput),
      h('div', {}, h('label', { for: 'ev-end' }, '結束（含當天）'), endInput)
    ),
    h('div', { class: 'row' }, h('button', { type: 'submit', class: 'primary' }, '查詢'))
  );
  const sourceNote = h('p', { class: 'form-note' });
  const setSourceNote = (fetched) => {
    sourceNote.textContent = `資料來源：文化部藝文活動${fetched ? `，${fetched} 更新` : '（每天更新）'}。` +
      '晚上＝19:00 以後開始。向左滑可以移除活動，之後不再出現。';
  };
  setSourceNote(null);

  const form = h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); run(); } },
    h('div', { class: 'ev-group' }, h('span', { class: 'ev-group-label' }, '期間'),
      h('div', { class: 'chips', role: 'group', 'aria-label': '期間' }, presetBtns)),
    custom,
    h('div', { class: 'ev-group' }, h('span', { class: 'ev-group-label' }, '日子'),
      h('div', { class: 'chips', role: 'group', 'aria-label': '日子與時段' }, dayBtns, eveningBtn)),
    h('div', { class: 'ev-group' }, h('span', { class: 'ev-group-label' }, '地區'),
      h('div', { class: 'chips', role: 'group', 'aria-label': '地區' }, cityBtns)),
    sourceNote
  );

  const status = h('p', { class: 'status', role: 'status' });
  const summary = h('p', { class: 'match', role: 'status' });
  const catRow = h('div', { class: 'chips ev-cats', role: 'group', 'aria-label': '類別' });
  const results = h('div', { id: 'ev-results' });
  view.append(modeRow, form, status, summary, catRow, results);

  function sync() {
    const press = (btns, v) => { for (const b of btns) b.setAttribute('aria-pressed', b.dataset.id === v ? 'true' : 'false'); };
    press(presetBtns, preset);
    press(dayBtns, days);
    press(cityBtns, city);
    eveningBtn.setAttribute('aria-pressed', evening ? 'true' : 'false');
    modeSearch.setAttribute('aria-pressed', mode === 'search' ? 'true' : 'false');
    modeFavs.setAttribute('aria-pressed', mode === 'favs' ? 'true' : 'false');
    modeFavs.textContent = prefs.favs.size ? `★ 收藏 ${prefs.favs.size}` : '★ 收藏';
    form.hidden = mode !== 'search';
    custom.hidden = preset !== 'custom';
  }

  function setMode(m) {
    if (mode === m) return;
    mode = m;
    set('events.mode', m);
    sync();
    if (m === 'favs') loadFavs(); else if (data) render(); else start();
  }

  function clearOutput() {
    summary.replaceChildren();
    catRow.replaceChildren();
    results.replaceChildren();
  }

  // ── 查詢 ──
  async function run() {
    let range;
    if (preset === 'custom') {
      range = customRange(startInput.value, endInput.value, today);
      if (range.error) { setStatus(status, range.error, 'warn'); return; }
    } else {
      range = presetRange(preset, today);
    }
    const key = `${range.start}|${range.endExclusive}`;
    const my = ++seq;
    cat = 'all';
    if (cache.has(key)) { data = cache.get(key); setStatus(status, '', ''); render(); return; }

    data = null;
    clearOutput();
    setStatus(status, `查詢 ${rangeLabel(range)} 的活動中…（每天第一次查詢要下載文化部資料，約需 10 秒）`, '');
    try {
      const d = await api('events.search', { start: range.start, endExclusive: range.endExclusive }, { timeoutMs: SEARCH_TIMEOUT_MS });
      if (my !== seq) return;
      cache.set(key, d);
      if (Array.isArray(d.favUids)) prefs.favs = new Set(d.favUids);
      data = d;
      setStatus(status, '', '');
      sync();
      if (mode === 'search') render();
    } catch (err) {
      if (my !== seq) return;
      setStatus(status, errText(err, '查詢失敗'), 'bad');
    }
  }

  function render() {
    if (!data || mode !== 'search') return;
    const range = data.range;
    const f = filterEvents(data, { city, days, evening, cat, hidden: prefs.hidden });
    const where = city === 'all' ? '台北、桃園' : cityName(city);
    const when = [days !== 'all' ? DAYS.find((d) => d.id === days).name : '', evening ? '晚上' : ''].filter(Boolean).join('・');
    const localHidden = [...(data.events || []), ...(data.ongoing || [])].filter((ev) => prefs.hidden.has(ev.uid)).length;
    const hiddenCount = (data.hiddenCount || 0) + localHidden;

    const warn = [];
    if (data.stale) warn.push(`今天的資料更新失敗，顯示 ${data.fetched} 的資料。`);
    if (data.truncated) warn.push('結果太多，只列出前 300 個，請縮短期間。');
    setStatus(status, warn.join(''), warn.length ? 'warn' : '');
    setSourceNote(data.fetched);

    summary.replaceChildren(
      h('b', {}, rangeLabel(range) + (when ? `・${when}` : '')),
      ` ${where}共 ${f.total} 個活動` +
        (f.ongoing.length ? `，另有 ${f.ongoing.length} 個長期展覽或課程進行中` : '') +
        (hiddenCount ? `（已移除 ${hiddenCount} 個）` : '')
    );

    catRow.replaceChildren(...(f.cats.length > 1 ? [{ name: 'all', label: `全部 ${f.total}` },
      ...f.cats.map((c) => ({ name: c.name, label: c.count ? `${c.name} ${c.count}` : c.name }))]
      .map((c) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': c.name === cat ? 'true' : 'false',
        onclick: () => { cat = c.name; render(); }
      }, c.label)) : []));

    const out = [];
    for (const g of groupByDay(f.events)) {
      const wd = weekday(g.day);
      out.push(h('h2', { class: `ev-day${wd === 0 || wd === 6 ? ' weekend' : ''}` },
        h('span', {}, dayLabel(g.day)), h('span', { class: 'count' }, `${g.events.length} 個`)));
      out.push(...g.events.map((ev) => eventCard(ev, { onSwipe: hideEvent })));
    }
    if (!f.events.length) {
      out.push(card(null, h('p', { class: 'muted' }, `${rangeLabel(range)} ${where}${when ? `（${when}）` : ''}沒有新開演的活動。`)));
    }
    if (f.ongoing.length) {
      out.push(h('details', { class: 'ev-ongoing' },
        h('summary', {}, `長期展覽、課程（${f.ongoing.length}）`),
        h('p', { class: 'form-note' }, '在這段期間之前就開始、期間內仍在進行的展覽或課程，依結束日排序。'),
        ...f.ongoing.map((ev) => eventCard(ev, { ongoing: true, onSwipe: hideEvent }))
      ));
    }
    results.replaceChildren(...out);
  }

  // ── 收藏頁 ──
  let favData = null;
  async function loadFavs() {
    const my = ++seq;
    clearOutput();
    setStatus(status, '讀取收藏中…', '');
    try {
      const d = await api('events.prefs', {}, { timeoutMs: SEARCH_TIMEOUT_MS });
      if (my !== seq) return;
      favData = d;
      prefs.favs = new Set((d.favs || []).map((e) => e.uid));
      prefs.hidden = new Set((d.hidden || []).map((e) => e.uid));
      setStatus(status, '', '');
      sync();
      renderFavs();
    } catch (err) {
      if (my !== seq) return;
      setStatus(status, errText(err, '讀取收藏失敗'), 'bad');
    }
  }

  function renderFavs() {
    if (!favData || mode !== 'favs') return;
    const favs = (favData.favs || []).filter((e) => prefs.favs.has(e.uid));
    const hidden = (favData.hidden || []).filter((e) => prefs.hidden.has(e.uid));
    const upcoming = favs.filter((e) => !e.ended);
    const ended = favs.filter((e) => e.ended);

    summary.replaceChildren(h('b', {}, `收藏 ${favs.length} 個`),
      favs.length ? ` 還有場次 ${upcoming.length} 個${ended.length ? `、已結束 ${ended.length} 個` : ''}。向左滑可以取消收藏。` : '');
    catRow.replaceChildren();

    const out = [];
    if (!favs.length) {
      out.push(card(null, h('p', { class: 'muted' }, '還沒有收藏。在活動卡片按「☆ 收藏」，就會出現在這裡，手機和電腦同步。')));
    }
    out.push(...upcoming.map((ev) => eventCard(ev, { withDay: true, onSwipe: unfavEvent })));
    if (ended.length) {
      out.push(h('details', { class: 'ev-ongoing' },
        h('summary', {}, `已結束（${ended.length}）`),
        ...ended.map((ev) => eventCard(ev, { withDay: true, ended: true, onSwipe: unfavEvent }))));
    }
    if (hidden.length) {
      out.push(h('details', { class: 'ev-ongoing' },
        h('summary', {}, `已移除的活動（${hidden.length}）`),
        h('p', { class: 'form-note' }, '這些活動不會出現在查詢結果和週五推播。按「復原」可以讓它重新出現。'),
        h('ul', { class: 'ev-hidden-list' }, hidden.map((x) => h('li', {},
          h('span', { class: 'ev-hidden-title' }, x.title || x.uid),
          h('span', { class: 'muted' }, x.at || ''),
          h('button', { type: 'button', class: 'chip', onclick: () => restoreHidden(x) }, '復原'))))));
    }
    results.replaceChildren(...out);
  }

  // ── 移除／收藏（先更新畫面，再寫後端；失敗時還原） ──
  function originalOf(uid) {
    const pools = [data?.events, data?.ongoing, favData?.favs];
    for (const p of pools) { const ev = (p || []).find((e) => e.uid === uid); if (ev) return ev; }
    return null;
  }
  function snapshot(ev) {
    const o = originalOf(ev.uid) || ev;
    return { uid: o.uid, title: o.title, cat: o.cat, catName: o.catName, url: o.url, src: o.src, shows: o.shows.slice(0, SNAPSHOT_SHOWS) };
  }
  const rerender = () => { sync(); if (mode === 'favs') renderFavs(); else render(); };

  async function savePref(uid, state, extra, undoLocal) {
    try {
      await api('events.setPref', { uid, state, ...extra });
    } catch (err) {
      undoLocal();
      rerender();
      showToast(errText(err, '儲存失敗'));
    }
  }

  function hideEvent(ev) {
    const wasFav = prefs.favs.has(ev.uid);
    prefs.hidden.add(ev.uid);
    prefs.favs.delete(ev.uid);
    rerender();
    const undoLocal = () => { prefs.hidden.delete(ev.uid); if (wasFav) prefs.favs.add(ev.uid); };
    showToast(`已移除「${short(ev.title)}」`, '復原', () => {
      undoLocal();
      rerender();
      savePref(ev.uid, wasFav ? 'fav' : 'none', wasFav ? { ev: snapshot(ev) } : {}, () => { prefs.hidden.add(ev.uid); });
    });
    savePref(ev.uid, 'hidden', { title: ev.title }, undoLocal);
  }

  function toggleFav(ev) {
    if (prefs.favs.has(ev.uid)) {
      unfavEvent(ev);
      return;
    }
    prefs.favs.add(ev.uid);
    rerender();
    showToast(`已收藏「${short(ev.title)}」，在上方「★ 收藏」查看`);
    savePref(ev.uid, 'fav', { ev: snapshot(ev) }, () => { prefs.favs.delete(ev.uid); });
  }

  function unfavEvent(ev) {
    const snap = snapshot(ev);
    prefs.favs.delete(ev.uid);
    rerender();
    showToast(`已取消收藏「${short(ev.title)}」`, '復原', () => {
      prefs.favs.add(ev.uid);
      rerender();
      savePref(ev.uid, 'fav', { ev: snap }, () => { prefs.favs.delete(ev.uid); });
    });
    savePref(ev.uid, 'none', {}, () => { prefs.favs.add(ev.uid); });
  }

  function restoreHidden(x) {
    prefs.hidden.delete(x.uid);
    cache.clear();   // 後端查詢結果原本就不含已移除的活動，復原後要重查
    data = null;
    rerender();
    showToast(`已復原「${short(x.title)}」`);
    savePref(x.uid, 'none', {}, () => { prefs.hidden.add(x.uid); });
  }

  // ── 活動卡片 ──
  function eventCard(ev, o = {}) {
    const first = ev.shows[0];
    const venues = new Set(ev.shows.map((s) => s.venue || s.addr));
    const cities = [...new Set(ev.shows.map((s) => s.city))];
    const approx = ev.shows.some((s) => s.approx);
    const url = safeUrl(ev.url);
    const isFav = prefs.favs.has(ev.uid);
    const long = o.ongoing || (first && first.start.slice(0, 10) !== ev.shows[ev.shows.length - 1].end.slice(0, 10) && ev.shows.length === 1);

    let when = '時間未提供';
    if (first) {
      when = o.ongoing
        ? `展期 ${showTime({ start: first.start, end: ev.shows[ev.shows.length - 1].end })}`
        : showTime(first, !!o.withDay);
    }
    if (o.ended) when = `已結束・${when}`;

    const tags = [h('span', { class: 'tag cat' }, ev.catName || '其他')];
    for (const c of cities) tags.push(h('span', { class: 'tag' }, cityName(c)));
    if (approx) tags.push(h('span', { class: 'tag', title: '地址沒寫縣市，依行政區或座標判斷' }, '縣市為推測'));

    let shows = null;
    if (!long && ev.shows.length > 1) {
      const list = ev.shows.slice(0, MAX_SHOW_TAGS).map((s) =>
        h('span', { class: 'tag' }, showTime(s, true) + (venues.size > 1 ? `・${s.venue || s.addr}` : '')));
      if (ev.shows.length > MAX_SHOW_TAGS) list.push(h('span', { class: 'tag' }, `…還有 ${ev.shows.length - MAX_SHOW_TAGS} 場`));
      shows = h('div', { class: 'ev-shows' },
        h('div', { class: 'ev-label' }, o.withDay ? `接下來 ${ev.shows.length} 場` : `符合條件的場次共 ${ev.shows.length} 場`),
        h('div', { class: 'tags' }, list));
    }

    const place = !first ? null : venues.size > 1 && !long
      ? h('p', { class: 'ev-place' }, '📍 ', h('b', {}, `${venues.size} 個地點`), '（見下方場次）')
      : h('p', { class: 'ev-place' }, '📍 ', h('b', {}, first.venue || '地點未提供'),
        first.addr && first.addr !== first.venue ? `　${first.addr}` : '');
    const price = ev.shows.find((s) => s.price)?.price;

    const foot = [
      h('button', { type: 'button', class: `tag tag-btn fav${isFav ? ' on' : ''}`, 'aria-pressed': isFav ? 'true' : 'false',
        onclick: () => toggleFav(ev) }, isFav ? '★ 已收藏' : '☆ 收藏')
    ];
    if (url) foot.push(h('a', { class: 'tag', href: url, target: '_blank', rel: 'noopener noreferrer' }, '活動頁面 ›'));
    else foot.push(h('span', { class: 'tag' }, '沒有提供連結'));
    if (o.onSwipe === hideEvent) {
      foot.push(h('button', { type: 'button', class: 'tag tag-btn remove', onclick: () => hideEvent(ev) }, '移除'));
    }

    const article = h('article', { class: `event${o.ongoing ? ' ongoing' : ''}` },
      h('div', { class: 'ev-top' }, h('span', { class: 'ev-time' }, when), h('div', { class: 'tags' }, tags)),
      h('h3', { class: 'ev-title' }, ev.title),
      place,
      price ? h('p', { class: 'ev-price' }, `💲 ${price}`) : null,
      ev.src ? h('p', { class: 'ev-price' }, `來源：${ev.src}`) : null,
      shows,
      h('div', { class: 'ev-foot' }, foot)
    );
    const wrap = h('div', { class: 'swipe', 'data-label': o.onSwipe === unfavEvent ? '取消收藏' : '移除' }, article);
    if (o.onSwipe) attachSwipe(wrap, article, () => o.onSwipe(ev));
    return wrap;
  }

  function start() {
    if (preset === 'custom') setStatus(status, '選好日期後按「查詢」。', '');
    else run();
  }

  sync();
  if (mode === 'favs') loadFavs(); else start();
}

export function unmount() {
  clearTimeout(toastTimer);
  toastEl?.remove();
  toastEl = null;
}

// ── 左滑手勢：水平拖曳超過 35%（最多 120px）就觸發；垂直捲動不受影響（touch-action: pan-y） ──
function attachSwipe(wrap, el, onSwipe) {
  let x0 = 0, y0 = 0, dx = 0, id = null, state = 'idle';   // idle | pending | drag
  const threshold = () => Math.min(120, el.offsetWidth * 0.35);
  const reset = () => {
    state = 'idle';
    wrap.classList.remove('dragging', 'armed');
    el.style.transform = '';
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('a, button, summary, input')) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; id = e.pointerId; state = 'pending';
  });
  el.addEventListener('pointermove', (e) => {
    if (state === 'idle' || e.pointerId !== id) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (state === 'pending') {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      if (Math.abs(my) > Math.abs(mx) || mx > 0) { state = 'idle'; return; }   // 垂直捲動或往右：不處理
      state = 'drag';
      try { el.setPointerCapture(id); } catch { /* 忽略 */ }
      wrap.classList.add('dragging');
    }
    dx = Math.min(0, mx);
    el.style.transform = `translateX(${dx}px)`;
    wrap.classList.toggle('armed', -dx > threshold());
  });
  el.addEventListener('pointerup', () => {
    if (state !== 'drag') { state = 'idle'; return; }
    if (-dx > threshold()) {
      state = 'idle';
      wrap.classList.remove('dragging');
      el.style.transform = `translateX(-${el.offsetWidth + 24}px)`;
      wrap.classList.add('leaving');
      setTimeout(onSwipe, 200);
    } else {
      reset();
    }
  });
  el.addEventListener('pointercancel', reset);
  // 拖曳後放開時瀏覽器會補一個 click，避免誤點到卡片內的連結
  el.addEventListener('click', (e) => { if (Math.abs(dx) > 8) { e.preventDefault(); e.stopPropagation(); dx = 0; } }, true);
}

// ── 底部提示（可復原） ──
function showToast(text, actionLabel, onAction) {
  clearTimeout(toastTimer);
  toastEl?.remove();
  toastEl = h('div', { class: 'toast', role: 'status' },
    h('span', {}, text),
    actionLabel ? h('button', { type: 'button', onclick: () => { hideToast(); onAction(); } }, actionLabel) : null);
  document.body.append(toastEl);
  toastTimer = setTimeout(hideToast, UNDO_MS);
}
function hideToast() {
  clearTimeout(toastTimer);
  toastEl?.remove();
  toastEl = null;
}

const short = (t) => (t.length > 18 ? `${t.slice(0, 17)}…` : t);
const errText = (err, prefix) => (err instanceof ApiError ? err.message : `${prefix}：${err?.message ?? err}`);
