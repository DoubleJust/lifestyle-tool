/**
 * Lifestyle Tool 後端：單一入口 doPost，依 action 分派。
 *
 * 請求格式（前端以 Content-Type: text/plain 送出 JSON 字串）：
 *   { "token": "...", "action": "ping", "params": { ... } }
 * 回應格式：
 *   成功 { "ok": true, "data": { ... } }
 *   失敗 { "ok": false, "code": "AUTH" | "DISABLED" | "BAD_ACTION" | "RATE" | "BUSY" | "BAD_INPUT" | "BAD_JSON" | "TOO_LARGE" | "INTERNAL" }
 *
 * 部署：「管理部署作業」→ 編輯（鉛筆）→ 版本選「新版本」→ 部署。這樣 /exec 網址才不會變。
 */

const BACKEND_VERSION = '1.5.1';

/**
 * action 白名單。limit = 每日呼叫上限（台北時間每天 00:00 重算）。
 * 新功能一律在這裡註冊，沒註冊的 action 會回 BAD_ACTION。
 */
const ACTIONS = {
  ping: {
    limit: 300,
    handler: function (params) {
      return {
        version: BACKEND_VERSION,
        now: Utilities.formatDate(new Date(), TZ_, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        tz: Session.getScriptTimeZone(),
        echo: typeof params.echo === 'string' ? params.echo.slice(0, 200) : null
      };
    }
  },
  // F1：持有的信用卡（試算表 my_cards 工作表）
  'cards.getMine': {
    limit: 200,
    handler: function () {
      return { card_ids: readMyCards_() };
    }
  },
  // F3：台北／桃園活動。params { start, endExclusive }（yyyy-MM-dd，半開區間，最長 31 天）
  'events.search': {
    limit: 50,
    handler: function (params) {
      return eventsSearch_(params);
    }
  },
  // F3：收藏清單與已移除清單
  'events.prefs': {
    limit: 200,
    handler: function () {
      return eventsPrefs_();
    }
  },
  // F3：左滑移除／收藏／復原。params { uid, state: 'hidden'|'fav'|'none', title?, ev? }
  'events.setPref': {
    limit: 300,
    handler: function (params) {
      return eventsSetPref_(params);
    }
  },
  // 外部 API 健康狀態（App 上方的異常提示、設定頁）
  health: {
    limit: 300,
    handler: function () {
      return healthStatus_();
    }
  },
  // 設定頁：本月 LINE 推播用量
  'line.usage': {
    limit: 30,
    handler: function () {
      return lineUsage_();
    }
  },
  // 步驟 0 測試頁（docs/poc.html）用：故意出錯，確認錯誤不會外洩
  throw: {
    limit: 20,
    handler: function () {
      throw new Error('intentional test error token=' + getProp_('APP_TOKEN'));
    }
  }
};

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > 10240) return reply_({ ok: false, code: 'TOO_LARGE' });

    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch (parseErr) {
      return reply_({ ok: false, code: 'BAD_JSON' });
    }
    if (!body || typeof body !== 'object') return reply_({ ok: false, code: 'BAD_JSON' });

    const props = PropertiesService.getScriptProperties().getProperties();
    if (!props.APP_TOKEN || typeof body.token !== 'string' || body.token !== props.APP_TOKEN) {
      return reply_({ ok: false, code: 'AUTH' });
    }
    if (props.KILL_SWITCH === '1') return reply_({ ok: false, code: 'DISABLED' });

    const action = typeof body.action === 'string' ? body.action : '';
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
      return reply_({ ok: false, code: 'BAD_ACTION' });
    }
    const def = ACTIONS[action];
    if (!consumeQuota_(action, def.limit)) return reply_({ ok: false, code: 'RATE' });

    const params = body.params && typeof body.params === 'object' ? body.params : {};
    const data = def.handler(params);
    return reply_({ ok: true, data: data === undefined ? null : data });
  } catch (err) {
    if (err && err.name === 'BusyError') return reply_({ ok: false, code: 'BUSY' });
    if (err && err.name === 'InputError') return reply_({ ok: false, code: 'BAD_INPUT', field: err.field || null });
    console.error('doPost INTERNAL: ' + sanitize_(String((err && err.stack) || err)).slice(0, 500));
    return reply_({ ok: false, code: 'INTERNAL' });
  }
}

/** 用瀏覽器直接打開 /exec 時的回應，方便確認部署是否成功 */
function doGet() {
  return reply_({ ok: true, hint: 'POST only', version: BACKEND_VERSION });
}

/** 手動執行一次：產生 64 字元隨機 token 存入指令碼屬性，並印在執行記錄。重跑 = 輪替 token */
function setupToken() {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('APP_TOKEN', token);
  console.log('APP_TOKEN = ' + token);
}

/** 手動執行：查看各 action 今日用量 */
function showQuotaUsage() {
  const props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).filter(function (k) { return k.indexOf('rl_') === 0; }).forEach(function (k) {
    console.log(k.slice(3) + ' → ' + props[k]);
  });
}
