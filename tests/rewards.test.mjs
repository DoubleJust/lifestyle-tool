// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, findMerchants, ruleApplies, ruleReward, recommend } from '../docs/js/lib/rewards.js';

const merchants = [
  { id: 'pxmart', name: '全聯', aliases: ['全聯福利中心', 'PX Mart'], categories: ['supermarket'] },
  { id: '7-11', name: '7-ELEVEN', aliases: ['711', '小七'], categories: ['convenience'] },
  { id: 'ubereats', name: 'Uber Eats', aliases: [], categories: ['food_delivery'] },
  { id: 'uber', name: 'Uber', aliases: [], categories: ['transport'] }
];
const cards = [
  { card_id: 'a', bank: 'X', name: 'A 卡' },
  { card_id: 'b', bank: 'X', name: 'B 卡' }
];
const base = { date: '2026-11-22', amount: 1000, categories: ['supermarket'], merchantId: 'pxmart', paymentMethod: 'any' };

test('normalize：全形、大小寫、臺/台、空白', () => {
  assert.equal(normalize('ＰＸ　Ｍａｒｔ'), 'pxmart');
  assert.equal(normalize('臺北'), '台北');
  assert.equal(normalize('7-ELEVEN'), '7eleven');
});

test('findMerchants：完全相符優先於部分相符', () => {
  assert.equal(findMerchants('全聯', merchants)[0].id, 'pxmart');
  assert.equal(findMerchants('px mart', merchants)[0].id, 'pxmart');
  assert.equal(findMerchants('小七', merchants)[0].id, '7-11');
  assert.equal(findMerchants('uber', merchants)[0].id, 'uber');       // 完全相符的 Uber 排第一
  assert.equal(findMerchants('ubereats', merchants)[0].id, 'ubereats');
  assert.deepEqual(findMerchants('', merchants), []);
  assert.deepEqual(findMerchants('不存在的店', merchants), []);
});

test('ruleApplies：期間、通路、排除、支付方式、新戶', () => {
  const r = { conditions: { merchant_categories: ['supermarket'] }, valid_from: '2026-07-01', valid_until: '2026-12-31' };
  assert.equal(ruleApplies(r, base).ok, true);
  assert.equal(ruleApplies(r, { ...base, date: '2027-01-01' }).reason, 'expired');
  assert.equal(ruleApplies(r, { ...base, date: '2026-06-30' }).reason, 'not_started');
  assert.equal(ruleApplies(r, { ...base, categories: ['dining'], merchantId: null }).reason, 'channel');
  assert.equal(ruleApplies({ conditions: {} }, { ...base, categories: [] }).ok, true, '一般消費適用所有店');
  assert.equal(ruleApplies({ conditions: {}, exclusions: ['pxmart'] }, base).reason, 'excluded');
  const pay = { conditions: { payment_methods: ['line_pay'] } };
  assert.equal(ruleApplies(pay, base).ok, true, '未指定支付方式時列入並顯示條件');
  assert.equal(ruleApplies(pay, { ...base, paymentMethod: 'apple_pay' }).reason, 'payment');
  assert.equal(ruleApplies({ conditions: { new_cardholder_only: true } }, base).reason, 'new_cardholder');
  assert.equal(ruleApplies({ enabled: false, conditions: {} }, base).reason, 'disabled');
});

test('ruleReward：上限、最低消費、點數換算', () => {
  assert.deepEqual(ruleReward({ reward: { rate: 0.03, cap: 200 } }, 1000), { value: 30, rate: 0.03, capped: false, belowMin: false });
  assert.equal(ruleReward({ reward: { rate: 0.03, cap: 200 } }, 10000).value, 200);
  assert.equal(ruleReward({ reward: { rate: 0.03, cap: 200 } }, 10000).capped, true);
  assert.equal(ruleReward({ reward: { rate: 0.04 }, conditions: { min_spend: 1000 } }, 999).value, 0);
  assert.equal(ruleReward({ reward: { rate: 0.05, type: 'points', point_value: 0.5 } }, 1000).value, 25);
});

test('recommend：同群組取最高、不同群組相加、依金額排序', () => {
  const rules = [
    { rule_id: 'a1', card_id: 'a', name: '一般', conditions: {}, reward: { rate: 0.01 }, stacking_group: 'base', last_verified: '2026-11-01' },
    { rule_id: 'a2', card_id: 'a', name: '超市加碼', conditions: { merchant_categories: ['supermarket'] }, reward: { rate: 0.02 }, stacking_group: 'bonus', last_verified: '2026-11-01' },
    { rule_id: 'b1', card_id: 'b', name: '一般', conditions: {}, reward: { rate: 0.015 }, stacking_group: 'base', last_verified: '2026-11-01' },
    { rule_id: 'b2', card_id: 'b', name: '超市', conditions: { merchant_categories: ['supermarket'] }, reward: { rate: 0.025 }, stacking_group: 'base', last_verified: '2026-01-01' }
  ];
  const res = recommend({ ...base, cards, rules });
  assert.equal(res[0].card.card_id, 'a');
  assert.equal(res[0].total, 30, 'A：1% + 2% 相加');
  assert.equal(res[1].total, 25, 'B：同群組取 2.5%，不加 1.5%');
  assert.equal(res[1].stale, true, 'B 的規則超過 90 天未核對');
  assert.equal(res[0].stale, false);

  const onlyB = recommend({ ...base, cards, rules, ownedIds: new Set(['b']) });
  assert.deepEqual(onlyB.map((r) => r.card.card_id), ['b']);
});

test('recommend：上限封頂後可能被其他卡超越', () => {
  const rules = [
    { rule_id: 'a', card_id: 'a', name: '高 % 低上限', conditions: {}, reward: { rate: 0.1, cap: 100 } },
    { rule_id: 'b', card_id: 'b', name: '低 % 無上限', conditions: {}, reward: { rate: 0.03 } }
  ];
  const res = recommend({ ...base, amount: 10000, cards, rules });
  assert.equal(res[0].card.card_id, 'b');
  assert.equal(res[0].total, 300);
  assert.equal(res[1].total, 100);
});
