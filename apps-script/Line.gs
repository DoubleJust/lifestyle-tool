/**
 * LINE Messaging API 推播。所有推播一律經過 pushLine_：
 *   KILL_SWITCH → 每日／每月上限 → push_log 去重 → 送出（帶 X-Line-Retry-Key）→ 更新 push_log。
 * 免費方案每月 200 則；這裡每日 5 則、每月 150 則就停（§8）。
 */

const LINE_API_ = 'https://api.line.me/v2/bot';
const LINE_LIMITS_ = { daily: 5, monthly: 150 };
const PUSH_LOG_SCAN_ = 400;   // 只讀最近 400 筆（每月最多 150 則，足夠涵蓋本月）

/**
 * @param {string} text 文字訊息（超過 4,900 字會截斷；LINE 上限 5,000）
 * @param {string} eventId 唯一事件 ID，例如 events-weekly:2026-11-30。同一個 ID 只會成功推播一次。
 * @return {{status: 'sent'|'skipped'|'disabled', reason?: string}} 失敗時丟出例外
 */
function pushLine_(text, eventId) {
  const props = PropertiesService.getScriptProperties().getProperties();
  if (props.KILL_SWITCH === '1') return { status: 'disabled' };
  const token = props.LINE_CHANNEL_ACCESS_TOKEN;
  const to = props.LINE_USER_ID;
  if (!token || !to) throw new Error('LINE_CHANNEL_ACCESS_TOKEN or LINE_USER_ID not set');

  const id = String(eventId).slice(0, 100);
  const sh = getSheet_('push_log');
  const log = readPushLog_(sh);
  const now = new Date();
  const plan = linePushPlan_(log, id, now.getTime(), ymd_(now), LINE_LIMITS_);
  if (!plan.go) {
    writeLog_('pushLine', (plan.reason === 'MONTHLY_LIMIT' ? 'WARN ' : 'SKIP ') + plan.reason + ' ' + id, 0);
    return { status: 'skipped', reason: plan.reason };
  }

  // 先寫 pending 再送：就算送出後程式當掉，下次也會用同一個 retry key 重送，LINE 會回 409 而不會重複
  const retryKey = plan.retryKey || Utilities.getUuid();
  sh.appendRow([now, id, 'pending', retryKey, '', '']);
  const row = sh.getLastRow();
  SpreadsheetApp.flush();

  let code = 0;
  let note = '';
  try {
    const res = UrlFetchApp.fetch(LINE_API_ + '/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, 'X-Line-Retry-Key': retryKey },
      payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
      muteHttpExceptions: true
    });
    code = res.getResponseCode();
    if (code !== 200 && code !== 409) note = sanitize_(res.getContentText()).slice(0, 300);
  } catch (e) {
    note = sanitize_(String(e && e.message || e)).slice(0, 300);
  }
  // 200 = 送出；409 = 同一個 retry key 先前已被接受（也就是已送出）
  // 網路錯誤或 5xx：不知道有沒有送達 → 保持 pending（算進用量，下次沿用同一個 key）
  const status = (code === 200 || code === 409) ? 'sent' : (code === 0 || code >= 500) ? 'pending' : 'failed';
  sh.getRange(row, 3, 1, 4).setValues([[status, retryKey, code || '', note || (code === 409 ? '先前已送出' : '')]]);

  // 同一事件之前沒結果的紀錄標成 retried，避免重複算進用量
  log.forEach(function (r) {
    if (r.eventId === id && (r.status === 'pending' || r.status === 'failed')) sh.getRange(r.row, 3).setValue('retried');
  });

  if (status !== 'sent') throw new Error('LINE push HTTP ' + (code || 'network') + ' ' + note);
  return { status: 'sent' };
}

/** push_log 最近的紀錄 → [{ row, ts, ymd, eventId, status, retryKey }] */
function readPushLog_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const first = Math.max(2, last - PUSH_LOG_SCAN_ + 1);
  return sh.getRange(first, 1, last - first + 1, 4).getValues().map(function (v, i) {
    const t = v[0] instanceof Date ? v[0] : new Date(v[0]);
    const ok = !isNaN(t.getTime());
    return {
      row: first + i,
      ts: ok ? t.getTime() : 0,
      ymd: ok ? ymd_(t) : '',
      eventId: String(v[1]),
      status: String(v[2]),
      retryKey: String(v[3] || '')
    };
  });
}

/** action line.usage：設定頁顯示本月推播用量 */
function lineUsage_() {
  const now = new Date();
  const month = ymd_(now).slice(0, 7);
  const log = readPushLog_(getSheet_('push_log'));
  const mine = log.filter(function (r) { return r.ymd.slice(0, 7) === month; });
  const count = function (s) { return mine.filter(function (r) { return r.status === s; }).length; };
  const official = lineOfficialUsage_();
  return {
    configured: !!(getProp_('LINE_CHANNEL_ACCESS_TOKEN') && getProp_('LINE_USER_ID')),
    month: month,
    sent: count('sent'),
    pending: count('pending'),
    failed: count('failed'),
    monthlyLimit: LINE_LIMITS_.monthly,
    dailyLimit: LINE_LIMITS_.daily,
    officialUsed: official.used,
    officialQuota: official.quota,
    recent: log.slice(-5).reverse().map(function (r) {
      return {
        time: r.ts ? Utilities.formatDate(new Date(r.ts), TZ_, 'yyyy-MM-dd HH:mm') : '',
        eventId: r.eventId.slice(0, 60),
        status: r.status
      };
    })
  };
}

/** LINE 官方的本月用量與額度；取不到時回 null（不影響其他功能） */
function lineOfficialUsage_() {
  const token = getProp_('LINE_CHANNEL_ACCESS_TOKEN');
  const out = { used: null, quota: null };
  if (!token) return out;
  const get = function (path) {
    try {
      const res = UrlFetchApp.fetch(LINE_API_ + path, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
      return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null;
    } catch (e) { return null; }
  };
  const used = get('/message/quota/consumption');
  const quota = get('/message/quota');
  if (used && typeof used.totalUsage === 'number') out.used = used.totalUsage;
  if (quota && quota.type === 'limited' && typeof quota.value === 'number') out.quota = quota.value;
  return out;
}

/** 手動執行：檢查 LINE 設定（不會推播、不耗用額度）。執行記錄只印出 bot 名稱與檢查結果。 */
function checkLineSetup() {
  const token = getProp_('LINE_CHANNEL_ACCESS_TOKEN');
  const to = getProp_('LINE_USER_ID');
  console.log('LINE_CHANNEL_ACCESS_TOKEN：' + (token ? '已設定' : '❌ 未設定'));
  console.log('LINE_USER_ID：' + (!to ? '❌ 未設定' : /^U[0-9a-f]{32}$/.test(to) ? '格式正確' : '❌ 格式不對（應為 U 開頭共 33 字元）'));
  if (!token) return;
  const res = UrlFetchApp.fetch(LINE_API_ + '/info', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (res.getResponseCode() === 200) {
    console.log('✅ Token 有效，官方帳號：' + JSON.parse(res.getContentText()).displayName);
  } else {
    console.log('❌ Token 無效（HTTP ' + res.getResponseCode() + '），請重新發行 long-lived token');
  }
  const official = lineOfficialUsage_();
  console.log('本月 LINE 官方計數：' + official.used + '／' + official.quota);
}
