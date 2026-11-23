import { h, card, setStatus } from '../ui.js';
import { call, ApiError } from '../api.js';
import { get, set } from '../store.js';
import { findMerchantsScored, recommend, PAYMENT_METHODS } from '../lib/rewards.js';

const MAX_CHOICES = 8;            // 店名比對到多個通路時，最多列幾個按鈕
const MAIN_PAYMENTS = 7;          // 支付方式先顯示前幾個，其餘收在「更多」
const TYPE_DELAY_MS = 250;        // 打字時延遲多久才重新計算

const MY_CARDS_KEY = 'myCards';   // localStorage 快取：{ ids: [...], at: ISO 時間 }

let data = null;                  // { cards, rules, merchants, categories }

async function loadData() {
  if (data) return data;
  const [c, r, m] = await Promise.all(
    ['./data/cards.json', './data/rewards.json', './data/merchants.json'].map((u) =>
      fetch(u).then((res) => { if (!res.ok) throw new Error(`${u} ${res.status}`); return res.json(); })
    )
  );
  data = { cards: c.cards || [], rules: r.rules || [], merchants: m.merchants || [], categories: m.categories || [] };
  return data;
}

function cachedMyCards() {
  try { return JSON.parse(get(MY_CARDS_KEY, 'null')); } catch { return null; }
}

function todayTaipei() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}

const money = (n) => `NT$${n.toLocaleString('zh-TW', { maximumFractionDigits: n < 10 ? 2 : n < 100 ? 1 : 0 })}`;
const pct = (r) => `${(r * 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}%`;

export async function mount(view) {
  const status = h('p', { class: 'status', role: 'status' });
  view.append(status);
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    setStatus(status, '回饋規則載入失敗，請檢查網路後重新整理。', 'bad');
    return;
  }
  status.remove();

  const { cards, rules, merchants, categories } = data;
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  // ── 輸入區 ──
  const nameInput = h('input', {
    id: 'merchant', type: 'text', list: 'merchant-list', autocomplete: 'off',
    placeholder: '店名，例如：全聯、Uber Eats', enterkeyhint: 'search', 'aria-label': '店名'
  });
  const datalist = h('datalist', { id: 'merchant-list' }, merchants.map((m) => h('option', { value: m.name })));
  const amountInput = h('input', {
    id: 'amount', type: 'number', inputmode: 'numeric', min: '1', step: '1',
    value: get('cards.amount', '1000'), 'aria-label': '金額（估算用）'
  });

  // 支付方式：chip 按鈕（單選）
  let pay = get('cards.pay', 'any');
  if (!PAYMENT_METHODS.some((p) => p.id === pay)) pay = 'any';
  const payButtons = PAYMENT_METHODS.map((p, i) => h('button', {
    type: 'button', class: 'chip', 'data-pay': p.id, hidden: i >= MAIN_PAYMENTS,
    onclick: () => { pay = p.id; set('cards.pay', pay); syncPay(); if (hasQuery()) run(); }
  }, p.name));
  const moreBtn = h('button', { type: 'button', class: 'chip more', onclick: () => {
    payButtons.forEach((b) => { b.hidden = false; });
    moreBtn.hidden = true;
  } }, '更多…');
  function syncPay() {
    for (const b of payButtons) b.setAttribute('aria-pressed', b.dataset.pay === pay ? 'true' : 'false');
  }
  if (PAYMENT_METHODS.findIndex((p) => p.id === pay) >= MAIN_PAYMENTS) moreBtn.click();
  syncPay();

  const catSelect = h('select', { id: 'category', 'aria-label': '類別' },
    h('option', { value: '' }, '類別：依店名判斷'),
    categories.map((c) => h('option', { value: c.id }, c.name))
  );
  const holidayBox = h('input', { id: 'holiday', type: 'checkbox' });
  const ownedBox = h('input', { id: 'owned', type: 'checkbox' });
  const ownedNote = h('p', { class: 'form-note' });

  const form = h('form', { class: 'card', role: 'search', onsubmit: (e) => {
    e.preventDefault();
    nameInput.blur();   // 收起手機鍵盤
    run();
  } },
    h('div', { class: 'search-row' },
      h('span', { class: 'icon', 'aria-hidden': 'true' }, '🔍'),
      nameInput, datalist,
      h('label', { class: 'amount-pill', for: 'amount' }, 'NT$', amountInput)
    ),
    h('div', { class: 'chips', role: 'group', 'aria-label': '支付方式' }, payButtons, moreBtn),
    h('div', { class: 'opts' },
      h('label', { for: 'owned', class: 'check' }, ownedBox, '只看我的卡'),
      h('label', { for: 'holiday', class: 'check' }, holidayBox, '今天是國定假日'),
      catSelect
    ),
    ownedNote
  );

  const matchInfo = h('p', { class: 'match', role: 'status' });
  const chooser = h('div', { class: 'chooser', hidden: true });
  const results = h('div', { id: 'results' });
  let pickedId = null;   // 使用者在按鈕中選的通路；改店名時清除
  const demoNote = cards.some((c) => c.card_id.startsWith('demo_'))
    ? card(null, h('p', { class: 'status warn' }, '目前是範例資料，數字都是虛構的。匯入你的回饋規則後才會顯示真實卡片。'))
    : null;

  view.append(...[demoNote, form, matchInfo, chooser, results].filter(Boolean));

  const hasQuery = () => results.childElementCount > 0 || nameInput.value.trim() !== '';
  let typeTimer = 0;
  const runSoon = () => { clearTimeout(typeTimer); typeTimer = setTimeout(run, TYPE_DELAY_MS); };
  nameInput.addEventListener('input', () => { pickedId = null; runSoon(); });
  amountInput.addEventListener('input', () => { if (hasQuery()) runSoon(); });

  // ── 持有的卡：先用快取，背景向後端更新 ──
  let owned = cachedMyCards();
  const applyOwned = () => {
    if (owned && owned.ids.length) {
      ownedBox.disabled = false;
      ownedBox.checked = get('cards.onlyOwned', '1') === '1';
      const known = owned.ids.filter((id) => cards.some((c) => c.card_id === id)).length;
      ownedNote.textContent = `試算表記錄你持有 ${owned.ids.length} 張卡（規則檔中有 ${known} 張）。`;
    } else {
      ownedBox.checked = false;
      ownedBox.disabled = true;
      ownedNote.textContent = '尚未取得持有卡片清單，先顯示所有卡。';
    }
  };
  applyOwned();
  call('cards.getMine').then((d) => {
    owned = { ids: Array.isArray(d?.card_ids) ? d.card_ids : [], at: new Date().toISOString() };
    set(MY_CARDS_KEY, JSON.stringify(owned));
    applyOwned();
    if (results.childElementCount) run();
  }).catch((err) => {
    if (!owned) ownedNote.textContent = err instanceof ApiError && err.code === 'NO_TOKEN'
      ? '尚未設定 token（到「設定」頁），先顯示所有卡。'
      : `無法取得持有卡片清單：${err.message ?? err}，先顯示所有卡。`;
  });

  ownedBox.addEventListener('change', () => { set('cards.onlyOwned', ownedBox.checked ? '1' : '0'); if (hasQuery()) run(); });
  catSelect.addEventListener('change', () => { if (hasQuery() || catSelect.value) run(); });
  holidayBox.addEventListener('change', () => { if (hasQuery()) run(); });

  // ── 計算並顯示 ──
  function run() {
    clearTimeout(typeTimer);
    const amount = Math.round(Number(amountInput.value));
    if (!(amount > 0)) { matchInfo.textContent = '請輸入大於 0 的金額。'; results.replaceChildren(); return; }
    set('cards.amount', String(amount));

    const query = nameInput.value.trim();
    const found = query ? findMerchantsScored(query, merchants).map((s) => s.m) : [];
    const merchant = found.find((m) => m.id === pickedId) || found[0] || null;
    renderChooser(catSelect.value ? [] : found, merchant);
    let cats;
    if (catSelect.value) {
      cats = [catSelect.value];
      matchInfo.replaceChildren('類別 ', h('b', {}, catName[catSelect.value]), '（手動選擇）');
    } else if (merchant) {
      cats = merchant.categories;
      matchInfo.replaceChildren('比對到 ', h('b', {}, merchant.name), ` → ${cats.map((c) => catName[c] || c).join('、')}`);
    } else {
      cats = [];
      matchInfo.textContent = query
        ? `找不到「${query}」，先用一般消費計算；可以在「類別」手動選擇。`
        : '未輸入店名，以一般消費計算。';
    }

    const list = recommend({
      cards, rules, amount,
      date: todayTaipei(),
      merchantId: catSelect.value ? null : merchant?.id ?? null,
      categories: cats,
      paymentMethod: pay,
      isHoliday: holidayBox.checked,
      ownedIds: ownedBox.checked && owned?.ids?.length ? new Set(owned.ids) : null
    });

    results.replaceChildren(...(list.length ? list.map(renderResult) : [
      card(null, h('p', { class: 'muted' }, '沒有適用的卡片。'))
    ]));
  }

  // 店名比對到 2 個以上通路時，列出按鈕讓使用者選
  function renderChooser(found, selected) {
    if (found.length < 2) { chooser.hidden = true; chooser.replaceChildren(); return; }
    const shown = found.slice(0, MAX_CHOICES);
    chooser.replaceChildren(...[
      h('div', { class: 'muted' }, `「${nameInput.value.trim()}」對到 ${found.length} 個通路，請選擇：`),
      h('div', { class: 'choices' }, shown.map((m) =>
        h('button', {
          type: 'button',
          class: m === selected ? 'choice active' : 'choice',
          'aria-pressed': m === selected ? 'true' : 'false',
          onclick: () => { pickedId = m.id; run(); }
        }, m.name)
      )),
      found.length > MAX_CHOICES ? h('div', { class: 'muted' }, `還有 ${found.length - MAX_CHOICES} 個，請輸入更完整的店名。`) : null
    ].filter(Boolean)); // replaceChildren 會把 null 變成文字，要先濾掉
    chooser.hidden = false;
  }

  function renderResult(r, i) {
    const tag = (t) => t.href
      ? h('a', { class: `tag ${t.kind}`.trim(), href: t.href, target: '_blank', rel: 'noopener' }, t.text)
      : h('span', { class: `tag ${t.kind}`.trim() }, t.text);
    return h('article', { class: `result rank-${(i % 3) + 1}` },
      h('div', { class: 'result-head' },
        h('div', {},
          h('span', { class: 'rank-badge' }, i === 0 ? '🏆 最推薦' : `第 ${i + 1} 名`),
          h('div', { class: 'result-name' }, r.card.name),
          h('div', { class: 'result-bank' }, r.card.bank)
        ),
        h('div', { class: 'result-total' },
          h('div', { class: 'pct' }, pct(r.effectiveRate)),
          h('div', { class: 'money' }, `約 ${money(r.total)}`)
        )
      ),
      h('div', { class: 'parts' }, r.parts.map((p) =>
        h('div', { class: 'part' },
          h('div', { class: 'part-name' },
            h('span', {}, `${p.name}　${pct(p.rate)}`),
            p.source_url ? h('a', { href: p.source_url, target: '_blank', rel: 'noopener' }, '官方說明 ›') : null
          ),
          p.tags.length ? h('div', { class: 'tags' }, p.tags.map(tag)) : null
        )
      )),
      cardFooter(r),
      r.stale ? h('p', { class: 'status warn' }, '部分規則超過 90 天未核對，可能已變動。') : null
    );
  }

  // 卡片層級的說明：計算方式、取整造成的差額、不回饋項目連結
  function cardFooter(r) {
    const tags = [];
    if (Math.abs(r.roundedAway) >= 0.005) {
      tags.push(h('span', { class: `tag ${r.roundedAway > 0 ? 'bad' : ''}`.trim() },
        `這筆 ${money(r.exactTotal)} → ${r.card.rounding === 'floor' ? '捨去' : '四捨五入'}成 ${money(r.payout)}`));
    }
    if (r.card.rounding_note) tags.push(h('span', { class: 'tag' }, r.card.rounding_note));
    if (r.card.exclusions_url) {
      tags.push(h('a', { class: 'tag', href: r.card.exclusions_url, target: '_blank', rel: 'noopener' }, '不回饋項目 ›'));
    }
    return tags.length ? h('div', { class: 'result-foot' }, tags) : null;
  }
}
