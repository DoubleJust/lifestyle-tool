// 信用卡回饋計算引擎（純函式，不碰 DOM，可在 Node 直接測試）。

export const PAYMENT_METHODS = [
  { id: 'any', name: '不指定' },
  { id: 'physical', name: '實體卡' },
  { id: 'apple_pay', name: 'Apple Pay' },
  { id: 'google_pay', name: 'Google Pay' },
  { id: 'samsung_pay', name: 'Samsung Pay' },
  { id: 'line_pay', name: 'LINE Pay' },
  { id: 'taishin_pay', name: '台新 Pay' },
  { id: 'jko_pay', name: '街口支付' },
  { id: 'pi_wallet', name: 'Pi 拍錢包' },
  { id: 'taiwan_pay', name: '台灣 Pay' },
  { id: 'online', name: '網路刷卡' }
];
const PAYMENT_NAME = Object.fromEntries(PAYMENT_METHODS.map((p) => [p.id, p.name]));
const CAP_PERIOD_NAME = { month: '每月', quarter: '每季', year: '每年', campaign: '活動期間' };
const STALE_DAYS = 90;

/** 比對用正規化：全形轉半形、小寫、臺→台、去掉空白與常見符號 */
export function normalize(s) {
  return String(s ?? '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .toLowerCase()
    .replace(/臺/g, '台')
    .replace(/[\s\-_.·・'’"()（）【】\[\]]/g, '');
}

/** 依店名找商家，回傳依相似度排序的 merchant 陣列 */
export function findMerchants(query, merchants) {
  const q = normalize(query);
  if (!q) return [];
  const scored = [];
  for (const m of merchants) {
    let score = 0;
    for (const raw of [m.name, ...(m.aliases || [])]) {
      const n = normalize(raw);
      if (!n) continue;
      if (n === q) score = Math.max(score, 100);
      else if (n.startsWith(q) || q.startsWith(n)) score = Math.max(score, n.length >= 2 ? 70 : 0);
      else if ((n.includes(q) && q.length >= 2) || (q.includes(n) && n.length >= 2)) score = Math.max(score, 50);
    }
    if (score > 0) scored.push({ m, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.m);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/**
 * 判斷一條規則是否適用。ctx：{ date, merchantId, categories[], paymentMethod, includeNewCardholder }
 * 回傳 { ok: boolean, reason?: string }
 */
export function ruleApplies(rule, ctx) {
  if (rule.enabled === false) return { ok: false, reason: 'disabled' };
  if (rule.valid_from && ctx.date < rule.valid_from) return { ok: false, reason: 'not_started' };
  if (rule.valid_until && ctx.date > rule.valid_until) return { ok: false, reason: 'expired' };

  const c = rule.conditions || {};
  if (c.new_cardholder_only && !ctx.includeNewCardholder) return { ok: false, reason: 'new_cardholder' };
  if (c.holiday_only && !ctx.isHoliday) return { ok: false, reason: 'holiday' };

  const cats = ctx.categories || [];
  const byMerchant = Array.isArray(c.merchants) && c.merchants.length > 0;
  const byCategory = Array.isArray(c.merchant_categories) && c.merchant_categories.length > 0;
  if (byMerchant || byCategory) {
    const hitM = byMerchant && ctx.merchantId && c.merchants.includes(ctx.merchantId);
    const hitC = byCategory && cats.some((x) => c.merchant_categories.includes(x));
    if (!hitM && !hitC) return { ok: false, reason: 'channel' };
  }

  const ex = rule.exclusions || [];
  if (ex.length && ((ctx.merchantId && ex.includes(ctx.merchantId)) || cats.some((x) => ex.includes(x)))) {
    return { ok: false, reason: 'excluded' };
  }

  const pm = ctx.paymentMethod;
  if (Array.isArray(c.payment_methods) && c.payment_methods.length && pm && pm !== 'any' && !c.payment_methods.includes(pm)) {
    return { ok: false, reason: 'payment' };
  }
  return { ok: true };
}

/** 計算單條規則的預估回饋 */
export function ruleReward(rule, amount) {
  const r = rule.reward || {};
  const c = rule.conditions || {};
  const rate = Number(r.rate) || 0;
  const pv = r.type === 'points' ? (Number(r.point_value) || 1) : 1;
  const belowMin = typeof c.min_spend === 'number' && amount < c.min_spend;
  let capped = false;
  // spend_cap：每期「消費金額」上限，超過部分不回饋
  let base = amount;
  if (typeof r.spend_cap === 'number' && amount > r.spend_cap) { base = r.spend_cap; capped = true; }
  let value = belowMin ? 0 : base * rate * pv;
  // cap：每期「回饋金額」上限
  if (typeof r.cap === 'number' && value > r.cap) { value = r.cap; capped = true; }
  return { value: Math.round(value * 100) / 100, rate: rate * pv, capped, belowMin };
}

/** 規則的條件標籤（顯示用） */
export function ruleTags(rule, { capped = false, belowMin = false } = {}) {
  const c = rule.conditions || {};
  const r = rule.reward || {};
  const tags = [];
  if (rule.plan) tags.push({ text: `方案：${rule.plan}`, kind: 'accent' });
  if (c.holiday_only) tags.push({ text: '僅國定假日', kind: 'warn' });
  if (c.registration_required) tags.push({ text: '需登錄', href: c.registration_url || null, kind: 'warn' });
  if (Array.isArray(c.payment_methods) && c.payment_methods.length) {
    tags.push({ text: `限 ${c.payment_methods.map((p) => PAYMENT_NAME[p] || p).join('／')}`, kind: 'warn' });
  }
  if (typeof c.min_spend === 'number') tags.push({ text: `單筆滿 NT$${c.min_spend.toLocaleString()}`, kind: belowMin ? 'bad' : '' });
  const period = CAP_PERIOD_NAME[r.cap_period] || '每期';
  if (typeof r.spend_cap === 'number') {
    tags.push({ text: `${period}消費上限 NT$${r.spend_cap.toLocaleString()}`, kind: capped ? 'bad' : '' });
  }
  if (typeof r.cap === 'number') {
    tags.push({ text: `${period}回饋上限 NT$${r.cap.toLocaleString()}`, kind: capped ? 'bad' : '' });
  }
  if (r.no_cap) tags.push({ text: '無上限', kind: '' });
  if (r.type === 'points') tags.push({ text: `點數（1 點≈NT$${Number(r.point_value) || 1}）`, kind: '' });
  if (r.type === 'discount') tags.push({ text: '折抵', kind: '' });
  for (const n of rule.notes || []) tags.push({ text: n, kind: '' });
  if (rule.valid_until) tags.push({ text: `至 ${rule.valid_until}`, kind: '' });
  return tags;
}

/**
 * 主函式：回傳依預估回饋排序的卡片清單。
 * input：{ cards, rules, amount, date, merchantId, categories, paymentMethod, ownedIds?: Set|null, includeNewCardholder? }
 * 同一張卡：同 stacking_group 取最高，不同群組相加。
 */
export function recommend(input) {
  const { cards, rules, amount, date, ownedIds = null } = input;
  const cardById = new Map(cards.map((c) => [c.card_id, c]));
  const perCard = new Map();

  for (const rule of rules) {
    if (!cardById.has(rule.card_id)) continue;
    if (ownedIds && !ownedIds.has(rule.card_id)) continue;
    if (!ruleApplies(rule, input).ok) continue;
    const rw = ruleReward(rule, amount);
    const group = rule.stacking_group || 'default';
    const entry = perCard.get(rule.card_id) || new Map();
    const prev = entry.get(group);
    const better = !prev || rw.value > prev.reward.value ||
      (rw.value === prev.reward.value && (rule.priority || 0) > (prev.rule.priority || 0));
    if (better) entry.set(group, { rule, reward: rw });
    perCard.set(rule.card_id, entry);
  }

  const results = [];
  for (const [cardId, groups] of perCard) {
    const parts = [...groups.values()]
      .sort((a, b) => b.reward.value - a.reward.value)
      .map(({ rule, reward }) => ({
        rule_id: rule.rule_id,
        name: rule.name,
        value: reward.value,
        rate: reward.rate,
        tags: ruleTags(rule, reward),
        source_url: rule.source_url || null,
        stale: !rule.last_verified || daysBetween(rule.last_verified, date) > STALE_DAYS
      }));
    const total = Math.round(parts.reduce((s, p) => s + p.value, 0) * 100) / 100;
    results.push({
      card: cardById.get(cardId),
      total,
      effectiveRate: amount > 0 ? total / amount : 0,
      parts,
      stale: parts.some((p) => p.stale)
    });
  }

  return results.sort((a, b) => b.total - a.total || a.card.name.localeCompare(b.card.name, 'zh-Hant'));
}
