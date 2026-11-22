// 真實資料的完整性檢查與常用情境（node --test tests/）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findMerchants, recommend } from '../docs/js/lib/rewards.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../docs/data/${f}`, import.meta.url), 'utf8'));
const { cards } = load('cards.json');
const { rules } = load('rewards.json');
const { merchants, categories } = load('merchants.json');

test('資料完整性：id 不重複、引用都存在', () => {
  const cardIds = new Set(cards.map((c) => c.card_id));
  const merchantIds = new Set(merchants.map((m) => m.id));
  const catIds = new Set(categories.map((c) => c.id));
  assert.equal(cardIds.size, cards.length, 'card_id 重複');
  assert.equal(merchantIds.size, merchants.length, 'merchant id 重複');
  assert.equal(new Set(rules.map((r) => r.rule_id)).size, rules.length, 'rule_id 重複');
  for (const c of cards) for (const id of c.exclusions || []) assert.ok(catIds.has(id) || merchantIds.has(id), `${c.card_id} 排除不存在的 ${id}`);
  for (const m of merchants) for (const c of m.categories) assert.ok(catIds.has(c), `${m.id} 的類別 ${c} 不存在`);
  for (const r of rules) {
    assert.ok(cardIds.has(r.card_id), `${r.rule_id} 的 card_id 不存在`);
    for (const id of r.conditions?.merchants || []) assert.ok(merchantIds.has(id), `${r.rule_id} 引用不存在的商家 ${id}`);
    for (const id of r.conditions?.merchant_categories || []) assert.ok(catIds.has(id), `${r.rule_id} 引用不存在的類別 ${id}`);
    for (const id of r.exclusions || []) assert.ok(catIds.has(id) || merchantIds.has(id), `${r.rule_id} 排除不存在的 ${id}`);
    assert.ok(r.reward.rate > 0 && r.reward.rate < 1, `${r.rule_id} 回饋率要用小數`);
  }
});

// 依擁有者給的常用情境：店名 → 預期每張卡的最佳回饋率（不指定支付方式、非假日）
const DATE = '2026-11-22';
function rates(query, opts = {}) {
  const m = findMerchants(query, merchants)[0];
  assert.ok(m, `找不到「${query}」`);
  const res = recommend({
    cards, rules, amount: 1000, date: DATE, merchantId: m.id, categories: m.categories,
    paymentMethod: opts.pay || 'any', isHoliday: !!opts.holiday
  });
  return Object.fromEntries(res.map((r) => [r.card.card_id, Math.round(r.effectiveRate * 1000) / 10]));
}

test('情境：50嵐（大戶卡手搖飲不回饋）', () => assert.deepEqual(rates('50嵐'), { taishin_richart: 10 }));
test('情境：Uber', () => assert.deepEqual(rates('Uber'), { jko_card: 3.5, dawho: 3.5, taishin_richart: 3.3 }));
test('情境：UNIQLO', () => assert.deepEqual(rates('UNIQLO'), { dawho: 3.5, taishin_richart: 3.3 }));
test('情境：NET（不指定 → 台新Pay 3.8%；實體卡 → 3.3%）', () => {
  assert.deepEqual(rates('NET'), { taishin_richart: 3.8, dawho: 3.5 });
  assert.deepEqual(rates('NET', { pay: 'physical' }), { dawho: 3.5, taishin_richart: 3.3 });
});
test('情境：蝦皮', () => assert.deepEqual(rates('蝦皮'), { dawho: 3.5, taishin_richart: 3.3 }));
test('情境：台鐵（臺鐵也要對到）', () => {
  assert.deepEqual(rates('台鐵'), { dawho: 3.5, taishin_richart: 3.3 });
  assert.deepEqual(rates('臺鐵'), { dawho: 3.5, taishin_richart: 3.3 });
});
test('情境：高鐵', () => assert.deepEqual(rates('高鐵'), { jko_card: 3.5, dawho: 3.5, taishin_richart: 3.3 }));
test('情境：國賓（影城；Richart 只有 LINE Pay 2.3%）', () =>
  assert.deepEqual(rates('國賓'), { jko_card: 3.5, dawho: 3.5, taishin_richart: 2.3 }));

test('大戶卡刷 LINE Pay 仍算一般消費 3.5%', () => {
  const r = rates('國賓', { pay: 'line_pay' });
  assert.equal(r.dawho, 3.5);
  assert.equal(r.taishin_richart, 2.3);
});
test('超商：LINE Pay 不回饋，台新Pay 3.8%', () => {
  assert.equal(rates('7-11', { pay: 'line_pay' }).taishin_richart, undefined);
  assert.equal(rates('全家', { pay: 'taishin_pay' }).taishin_richart, 3.8);
});
test('國定假日：不在任何方案的店 Richart 至少 2%', () => {
  assert.equal(rates('IKEA').taishin_richart, 3.3);
  assert.equal(rates('威秀', { pay: 'physical' }).taishin_richart, undefined);
  assert.equal(rates('威秀', { pay: 'physical', holiday: true }).taishin_richart, 2);
});
test('海外：大戶 4.5%、Richart 3.3%', () => assert.deepEqual(rates('海外'), { dawho: 4.5, taishin_richart: 3.3 }));
function order(query) {
  const m = findMerchants(query, merchants)[0];
  return recommend({ cards, rules, amount: 1000, date: DATE, merchantId: m.id, categories: m.categories, paymentMethod: 'any' })
    .map((r) => r.card.card_id);
}
test('回饋率相同時排序：Richart → 街口 → 大戶', () => {
  assert.deepEqual(order('Uber'), ['jko_card', 'dawho', 'taishin_richart']);
  assert.deepEqual(order('高鐵'), ['jko_card', 'dawho', 'taishin_richart']);
});
test('金額 1 元：大戶仍顯示 3.5%（不是 4%）', () => {
  const m = findMerchants('海底撈', merchants)[0];
  const res = recommend({ cards, rules, amount: 1, date: DATE, merchantId: m.id, categories: m.categories, paymentMethod: 'apple_pay' });
  assert.equal(Math.round(res.find((r) => r.card.card_id === 'dawho').effectiveRate * 10000) / 100, 3.5);
});
test('大戶一般消費不回饋：全聯、超商、速食、手搖飲、停車費、稅款、罰款、境外匯款', () => {
  for (const q of ['全聯', '7-11', '全家', '麥當勞', '五十嵐', '清心福全', '停車費', '繳稅', '罰單', '匯款']) {
    assert.equal(rates(q).dawho, undefined, `${q} 不應該有大戶回饋`);
  }
  assert.equal(rates('清心福全').jko_card, 3.5, '街口卡清心福全仍有 3.5%');
});
test('街口卡繳費 0.15%', () => {
  const m = findMerchants('電費', merchants)[0];
  assert.equal(m.id, 'bill_payment');
  const res = recommend({ cards, rules, amount: 1000, date: DATE, merchantId: m.id, categories: m.categories, paymentMethod: 'any' });
  const jko = res.find((r) => r.card.card_id === 'jko_card');
  assert.equal(Math.round(jko.effectiveRate * 100000) / 1000, 0.15);
});
test('店名對到多個通路時都要列出（例：「星」→ 星宇航空、星聚點）', () => {
  const ids = findMerchants('星', merchants).map((m) => m.id);
  assert.ok(ids.includes('starlux') && ids.includes('superstar'));
});

function run(query, amount, opts = {}) {
  const m = findMerchants(query, merchants)[0];
  assert.ok(m, `找不到「${query}」`);
  return recommend({ cards, rules, amount, date: DATE, merchantId: m.id, categories: m.categories, paymentMethod: opts.pay || 'any' });
}
const byId = (res, id) => res.find((r) => r.card.card_id === id);

test('大戶：基本 1% 無上限＋任務加碼 2.5% 每月上限 NT$400', () => {
  const res = run('UNIQLO', 20000);
  assert.equal(byId(res, 'dawho').total, 600, '20,000 × 1% + 400');
  assert.equal(byId(run('UNIQLO', 16000), 'dawho').total, 560, '16,000 剛好 3.5%');
  assert.equal(byId(run('海外', 20000), 'dawho').total, 800, '20,000 × 2% + 400');
});

test('逐筆取整：Richart 捨去、街口四捨五入、大戶不取整', () => {
  // 高鐵 NT$100：Richart 3.3 → 3、街口 3.5 → 4、大戶 3.5
  const res = run('高鐵', 100);
  assert.equal(byId(res, 'taishin_richart').total, 3);
  assert.equal(byId(res, 'jko_card').total, 4);
  assert.equal(byId(res, 'dawho').total, 3.5);
  assert.deepEqual(res.map((r) => r.card.card_id), ['jko_card', 'dawho', 'taishin_richart']);
  // NT$10：Richart 0.33 → 0、街口 0.35 → 0，大戶 0.35 排第一
  const small = run('高鐵', 10);
  assert.equal(small[0].card.card_id, 'dawho');
  assert.equal(byId(small, 'taishin_richart').total, 0);
  assert.equal(byId(small, 'jko_card').total, 0);
  // 回饋率不受取整影響
  assert.equal(Math.round(byId(small, 'taishin_richart').effectiveRate * 1000) / 10, 3.3);
});

test('台新不回饋項目：Richart、街口都排除', () => {
  for (const q of ['YouTube', 'Spotify', '抖音', 'iCloud', 'Google Play', '悠遊卡自動加值', 'icash', '大全聯', '停車費', '罰單']) {
    const r = rates(q);
    assert.equal(r.taishin_richart, undefined, `${q} 不應該有 Richart 回饋`);
    // iCloud 不指定支付方式時，會列出街口支付限定的 1%（另一個測試）
    if (q !== 'iCloud') assert.equal(r.jko_card, undefined, `${q} 不應該有街口回饋`);
  }
  // 麥當勞：好饗刷（餐飲）不算，只有台新Pay 的 Pay著刷 例外
  assert.equal(rates('麥當勞', { pay: 'physical' }).taishin_richart, undefined);
  assert.equal(rates('麥當勞', { pay: 'taishin_pay' }).taishin_richart, 3.8);
  // 假日刷也不能用在不回饋項目
  assert.equal(rates('全聯', { holiday: true }).taishin_richart, undefined);
});

test('例外：街口卡用街口支付付 Apple 媒體服務 1%', () => {
  assert.equal(rates('iCloud', { pay: 'jko_pay' }).jko_card, 1);
  assert.equal(rates('iCloud', { pay: 'apple_pay' }).jko_card, undefined);
});

test('大戶悠遊卡自動加值 3%，不另享一般消費回饋', () => {
  assert.deepEqual(rates('悠遊卡自動加值'), { dawho: 3 });
  assert.equal(byId(run('悠遊卡自動加值', 5000), 'dawho').total, 100, '每月上限 NT$100');
});
