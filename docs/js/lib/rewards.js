// 信用卡回饋計算引擎（純函式，不碰 DOM，可在 Node 直接測試）。

// 順序 = 下拉選單順序（常用的排前面）
export const PAYMENT_METHODS = [
  { id: 'any', name: '不指定' },
  { id: 'physical', name: '實體卡' },
  { id: 'apple_pay', name: 'Apple Pay' },
  { id: 'line_pay', name: 'LINE Pay' },
  { id: 'taishin_pay', name: '台新 Pay' },
  { id: 'jko_pay', name: '街口支付' },
  { id: 'online', name: '網路刷卡' },
  { id: 'google_pay', name: 'Google Pay' },
  { id: 'samsung_pay', name: 'Samsung Pay' },
  { id: 'pi_wallet', name: 'Pi 拍錢包' },
  { id: 'taiwan_pay', name: '台灣 Pay' }
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
  return findMerchantsScored(query, merchants).map((s) => s.m);
}

/** 同 findMerchants，但保留分數：100 完全相符、70 開頭相符、50 部分相符 */
export function findMerchantsScored(query, merchants) {
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
  return scored.sort((a, b) => b.score - a.score);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function hitsExclusion(ex, ctx) {
  if (!ex || !ex.length) return false;
  return (ctx.merchantId && ex.includes(ctx.merchantId)) || (ctx.categories || []).some((x) => ex.includes(x));
}

/**
 * 判斷一條規則是否適用。ctx：{ date, merchantId, categories[], paymentMethod, includeNewCardholder }
 * card：可選，帶入卡片層級的 exclusions（銀行的「不回饋項目」）。
 *   規則的 merchants[] 明確列出這家店時，卡片層級的排除不套用（例：台新Pay 在 7-11 是官方例外）。
 * 回傳 { ok: boolean, reason?: string }
 */
export function ruleApplies(rule, ctx, card = null) {
  if (rule.enabled === false) return { ok: false, reason: 'disabled' };
  if (rule.valid_from && ctx.date < rule.valid_from) return { ok: false, reason: 'not_started' };
  if (rule.valid_until && ctx.date > rule.valid_until) return { ok: false, reason: 'expired' };

  const c = rule.conditions || {};
  if (c.new_cardholder_only && !ctx.includeNewCardholder) return { ok: false, reason: 'new_cardholder' };
  if (c.holiday_only && !ctx.isHoliday) return { ok: false, reason: 'holiday' };

  const cats = ctx.categories || [];
  const byMerchant = Array.isArray(c.merchants) && c.merchants.length > 0;
  const byCategory = Array.isArray(c.merchant_categories) && c.merchant_categories.length > 0;
  const named = byMerchant && !!ctx.merchantId && c.merchants.includes(ctx.merchantId);
  if (byMerchant || byCategory) {
    const hitC = byCategory && cats.some((x) => c.merchant_categories.includes(x));
    if (!named && !hitC) return { ok: false, reason: 'channel' };
  }

  if (hitsExclusion(rule.exclusions, ctx)) return { ok: false, reason: 'excluded' };
  if (card && !named && hitsExclusion(card.exclusions, ctx)) return { ok: false, reason: 'card_excluded' };

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
  // exact 用來比較與算回饋率；value 只是顯示用的四捨五入（金額很小時兩者差很多，例如 1 元）
  return { value: Math.round(value * 100) / 100, exact: value, rate: rate * pv, capped, belowMin };
}

/**
 * 依卡片的計算方式把「這一筆」的回饋取整（cards.json 的 rounding）：
 *   floor：逐筆、小數無條件捨去（台新 Richart）
 *   round：逐筆、四捨五入到個位數（街口卡）
 *   其他／未填：不逐筆取整（例：大戶卡依整月帳單合計計算）
 */
export function roundPayout(value, mode) {
  const EPS = 1e-9; // 避免 0.033 × 1000 = 32.999999… 被捨成 32
  if (mode === 'floor') return Math.floor(value + EPS);
  if (mode === 'round') return Math.round(value + EPS);
  return value;
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
    tags.push({ text: `${period}消費上限 NT$${r.spend_cap.toLocaleString()}`, kind: capped ? 'bad' : 'key' });
  }
  if (typeof r.cap === 'number') {
    tags.push({ text: `${period}回饋上限 NT$${r.cap.toLocaleString()}`, kind: capped ? 'bad' : 'key' });
  }
  if (r.no_cap) tags.push({ text: '無上限', kind: 'key' });
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
  const cardOrder = new Map(cards.map((c, i) => [c.card_id, i])); // 回饋相同時依 cards.json 的順序
  const perCard = new Map();

  for (const rule of rules) {
    if (!cardById.has(rule.card_id)) continue;
    if (ownedIds && !ownedIds.has(rule.card_id)) continue;
    if (!ruleApplies(rule, input, cardById.get(rule.card_id)).ok) continue;
    const rw = ruleReward(rule, amount);
    const group = rule.stacking_group || 'default';
    const entry = perCard.get(rule.card_id) || new Map();
    const prev = entry.get(group);
    const better = !prev || rw.exact > prev.reward.exact ||
      (rw.exact === prev.reward.exact && (rule.priority || 0) > (prev.rule.priority || 0));
    if (better) entry.set(group, { rule, reward: rw });
    perCard.set(rule.card_id, entry);
  }

  const results = [];
  for (const [cardId, groups] of perCard) {
    const picked = [...groups.values()].sort((a, b) => b.reward.exact - a.reward.exact);
    const exactTotal = picked.reduce((s, p) => s + p.reward.exact, 0);
    const parts = picked
      .map(({ rule, reward }) => ({
        rule_id: rule.rule_id,
        name: rule.name,
        value: reward.value,
        rate: reward.rate,
        tags: ruleTags(rule, reward),
        source_url: rule.source_url || null,
        stale: !rule.last_verified || daysBetween(rule.last_verified, date) > STALE_DAYS
      }));
    const card = cardById.get(cardId);
    const payout = roundPayout(exactTotal, card.rounding);
    results.push({
      card,
      total: Math.round(payout * 100) / 100,   // 這一筆實際拿到的（已依卡片規則取整）
      payout,
      exactTotal,                               // 取整前
      roundedAway: exactTotal - payout,          // 被取整吃掉的部分（四捨五入進位時為負）
      effectiveRate: amount > 0 ? exactTotal / amount : 0, // 方案回饋率，不受取整影響
      parts,
      stale: parts.some((p) => p.stale)
    });
  }

  // 依實際拿到的回饋排序；浮點誤差內視為相同，再依 cards.json 順序
  return results.sort((a, b) =>
    (Math.abs(b.payout - a.payout) > 1e-9 ? b.payout - a.payout : 0) ||
    cardOrder.get(a.card.card_id) - cardOrder.get(b.card.card_id));
}
