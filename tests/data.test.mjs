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

test('大戶每月消費上限 16,000：刷 20,000 只算 16,000 的 3.5%', () => {
  const m = findMerchants('UNIQLO', merchants)[0];
  const res = recommend({ cards, rules, amount: 20000, date: DATE, merchantId: m.id, categories: m.categories, paymentMethod: 'any' });
  assert.equal(res.find((r) => r.card.card_id === 'dawho').total, 560);
});
