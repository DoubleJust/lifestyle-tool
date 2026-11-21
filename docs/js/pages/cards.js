import { h, card, setStatus } from '../ui.js';
import { call, ApiError } from '../api.js';
import { get, set } from '../store.js';
import { findMerchants, recommend, PAYMENT_METHODS } from '../lib/rewards.js';

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

const money = (n) => `NT$${n.toLocaleString('zh-TW', { maximumFractionDigits: n < 100 ? 1 : 0 })}`;
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
  const nameInput = h('input', { id: 'merchant', type: 'text', list: 'merchant-list', autocomplete: 'off', placeholder: '例如：全聯、Uber Eats、蝦皮', enterkeyhint: 'search' });
  const datalist = h('datalist', { id: 'merchant-list' }, merchants.map((m) => h('option', { value: m.name })));
  const amountInput = h('input', { id: 'amount', type: 'number', inputmode: 'numeric', min: '1', step: '1', value: get('cards.amount', '1000') });
  const paySelect = h('select', { id: 'pay' }, PAYMENT_METHODS.map((p) => h('option', { value: p.id }, p.name)));
  paySelect.value = get('cards.pay', 'any');
  const catSelect = h('select', { id: 'category' },
    h('option', { value: '' }, '自動判斷（依店名）'),
    categories.map((c) => h('option', { value: c.id }, c.name))
  );
  const holidayBox = h('input', { id: 'holiday', type: 'checkbox' });
  const holidayLabel = h('label', { for: 'holiday', class: 'check' }, holidayBox, ' 今天是國定假日');
  const ownedBox = h('input', { id: 'owned', type: 'checkbox' });
  const ownedLabel = h('label', { for: 'owned', class: 'check' }, ownedBox, ' 只看我持有的卡');
  const ownedNote = h('p', { class: 'muted' });
  const searchBtn = h('button', { type: 'submit', class: 'primary' }, '推薦');

  const form = h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); run(); } },
    h('label', { for: 'merchant' }, '店名'), nameInput, datalist,
    h('div', { class: 'grid2' },
      h('div', {}, h('label', { for: 'amount' }, '金額（估算用）'), amountInput),
      h('div', {}, h('label', { for: 'pay' }, '支付方式'), paySelect)
    ),
    h('label', { for: 'category' }, '類別'), catSelect,
    holidayLabel,
    ownedLabel, ownedNote,
    h('div', { class: 'row' }, searchBtn)
  );

  const matchInfo = h('p', { class: 'muted', role: 'status' });
  const results = h('div', { id: 'results' });
  const demoNote = cards.some((c) => c.card_id.startsWith('demo_'))
    ? card(null, h('p', { class: 'status warn' }, '目前是範例資料，數字都是虛構的。匯入你的回饋規則後才會顯示真實卡片。'))
    : null;

  view.append(...[demoNote, form, matchInfo, results].filter(Boolean));

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

  ownedBox.addEventListener('change', () => { set('cards.onlyOwned', ownedBox.checked ? '1' : '0'); if (results.childElementCount) run(); });
  paySelect.addEventListener('change', () => { set('cards.pay', paySelect.value); if (results.childElementCount) run(); });
  catSelect.addEventListener('change', () => { if (results.childElementCount || nameInput.value.trim()) run(); });
  holidayBox.addEventListener('change', () => { if (results.childElementCount) run(); });

  // ── 計算並顯示 ──
  function run() {
    const amount = Math.round(Number(amountInput.value));
    if (!(amount > 0)) { matchInfo.textContent = '請輸入大於 0 的金額。'; results.replaceChildren(); return; }
    set('cards.amount', String(amount));

    const query = nameInput.value.trim();
    const found = query ? findMerchants(query, merchants) : [];
    const merchant = found[0] || null;
    let cats;
    if (catSelect.value) {
      cats = [catSelect.value];
      matchInfo.textContent = `類別：${catName[catSelect.value]}（手動選擇）`;
    } else if (merchant) {
      cats = merchant.categories;
      const others = found.slice(1, 3).map((m) => m.name);
      matchInfo.textContent = `比對到「${merchant.name}」→ ${cats.map((c) => catName[c] || c).join('、')}` +
        (others.length ? `（也可能是：${others.join('、')}）` : '');
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
      paymentMethod: paySelect.value,
      isHoliday: holidayBox.checked,
      ownedIds: ownedBox.checked && owned?.ids?.length ? new Set(owned.ids) : null
    });

    results.replaceChildren(...(list.length ? list.map(renderResult) : [
      card(null, h('p', { class: 'muted' }, '沒有適用的卡片。'))
    ]));
  }

  function renderResult(r, i) {
    return h('article', { class: `card result${i === 0 ? ' best' : ''}` },
      h('div', { class: 'result-head' },
        h('div', {},
          h('div', { class: 'result-name' }, i === 0 ? '🏆 ' : '', r.card.name),
          h('div', { class: 'muted' }, r.card.bank)
        ),
        h('div', { class: 'result-total' },
          h('div', { class: 'amount' }, pct(r.effectiveRate)),
          h('div', { class: 'muted' }, `約 ${money(r.total)}`)
        )
      ),
      h('ul', { class: 'parts' }, r.parts.map((p) =>
        h('li', {},
          h('div', {}, `${p.name}　${pct(p.rate)}`,
            p.source_url ? [' ', h('a', { href: p.source_url, target: '_blank', rel: 'noopener' }, '官方說明')] : null),
          p.tags.length ? h('div', { class: 'tags' }, p.tags.map((t) =>
            t.href
              ? h('a', { class: `tag ${t.kind}`, href: t.href, target: '_blank', rel: 'noopener' }, t.text)
              : h('span', { class: `tag ${t.kind}` }, t.text)
          )) : null
        )
      )),
      r.stale ? h('p', { class: 'status warn' }, '部分規則超過 90 天未核對，可能已變動。') : null
    );
  }
}
