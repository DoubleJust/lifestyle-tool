/**
 * 外部 API 的健康狀態：每次呼叫成功／失敗都記在指令碼屬性 HEALTH（JSON），
 * 前端用 action health 讀取，有異常就在 App 上方顯示提示（設定頁有完整狀態）。
 * healthRecord_／healthReport_ 是純函式（tests/health.test.mjs 測試）。
 */

// staleHours：超過這麼久沒檢查＝排程可能停了（0＝不檢查）。link：抓不到時 App 顯示「到 ○○ 找」的網址。
const HEALTH_SOURCES_ = {
  culture: { name: '文化部藝文活動', staleHours: 48, link: 'https://event.culture.tw/' },
  taipei: { name: '臺北旅遊網', staleHours: 48, link: 'https://www.travel.taipei/zh-tw/event-calendar/{year}', scrape: true },
  tycg: { name: '桃園觀光行事曆', staleHours: 48, link: 'https://travel.tycg.gov.tw/zh-tw/event/calendar' },
  accupass: { name: 'Accupass', staleHours: 48, link: 'https://www.accupass.com/?area=north', scrape: true },
  join1: { name: 'JOIN+1', staleHours: 48, link: 'https://join1.app/discover?r=nearby', scrape: true },
  line: { name: 'LINE 推播', staleHours: 0 }            // 只在推播時檢查，不看多久沒用
};

/** 更新一個來源的紀錄。since＝這次連續失敗從何時開始，fails＝連續失敗次數。 */
function healthRecord_(prev, ok, msg, now) {
  const p = prev || {};
  if (ok) return { status: 'ok', at: now, lastOk: now, since: 0, fails: 0, msg: '' };
  const wasFail = p.status === 'fail';
  return {
    status: 'fail', at: now, lastOk: p.lastOk || 0,
    since: wasFail && p.since ? p.since : now,
    fails: (wasFail ? p.fails || 0 : 0) + 1,
    msg: String(msg || '').slice(0, 200)
  };
}

/** 給前端的狀態清單。status：ok | fail | stale（太久沒檢查）| unknown（從沒檢查過） */
function healthReport_(health, now) {
  return Object.keys(HEALTH_SOURCES_).map(function (key) {
    const def = HEALTH_SOURCES_[key];
    const h = (health || {})[key] || null;
    let status = h ? h.status : 'unknown';
    if (h && status === 'ok' && def.staleHours && now - h.at > def.staleHours * 3600 * 1000) status = 'stale';
    return {
      key: key, name: def.name, status: status, scrape: !!def.scrape,
      link: def.link ? def.link.replace('{year}', String(new Date(now + 8 * 3600 * 1000).getUTCFullYear())) : '',
      at: h ? h.at || 0 : 0, lastOk: h ? h.lastOk || 0 : 0, since: h ? h.since || 0 : 0,
      fails: h ? h.fails || 0 : 0, msg: h ? h.msg || '' : ''
    };
  });
}

function healthRead_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('HEALTH') || '{}') || {}; } catch (e) { return {}; }
}

/** 記錄一次成功或失敗（錯誤訊息會遮罩機密）。本身失敗也不影響呼叫端。 */
function healthMark_(key, ok, msg) {
  try {
    const all = healthRead_();
    all[key] = healthRecord_(all[key], ok, ok ? '' : sanitize_(String(msg || '')), Date.now());
    PropertiesService.getScriptProperties().setProperty('HEALTH', JSON.stringify(all));
  } catch (e) {
    console.log('healthMark_ failed');
  }
}

/** action health */
function healthStatus_() {
  return { sources: healthReport_(healthRead_(), Date.now()) };
}

/**
 * 排程：每天 6 點。抓文化部資料（順便預熱今天的快取，讓第一次查詢變快）與其他四個來源（Sources.gs），
 * 失敗只記錄在 HEALTH 與 log、不推 LINE（避免天天推）；再把已結束活動的收藏／移除紀錄刪掉。
 */
function dailyHealthJob() {
  runJob_('dailyHealthJob', function () {
    let culture = '';
    let cultureOk = false;
    try {
      const d = evLoadRows_({ locked: true, allowStale: false });
      culture = 'culture ok rows=' + d.rows.length;
      cultureOk = true;
    } catch (e) {
      culture = 'culture FAIL ' + sanitize_(String(e && e.message || e)).slice(0, 120);
    }
    const extra = refreshExtraSources_();
    let prune = '略過清理（文化部資料不是今天的）';
    if (cultureOk) prune = 'prefs-' + evPruneExpiredPrefs_(evAllRows_({ locked: true, allowStale: false }).rows, ymd_(new Date()));
    healthNotifyOutages_();
    return [culture, extra, prune].join(' | ');
  });
}

/** 某個資料來源連續 2 次（約 2 天）抓不到時，推 1 則 LINE 提醒（同一次故障只推一次）。 */
function healthNotifyOutages_() {
  const tz = TZ_;
  healthReport_(healthRead_(), Date.now()).forEach(function (s) {
    if (s.key === 'line' || s.status !== 'fail' || s.fails !== 2) return;
    try {
      pushLine_('⚠️ ' + s.name + '連續 2 天抓不到資料' + (s.scrape ? '（網頁可能改版或被擋）' : '') + '：' + s.msg.slice(0, 120) +
        '\nApp 已改成顯示「到 ' + s.name + ' 找」的連結，需要修 tool。',
        'health:' + s.key + ':' + Utilities.formatDate(new Date(s.since), tz, 'yyyy-MM-dd'));
    } catch (e) {
      writeLog_('healthNotify', 'FAIL ' + sanitize_(String(e && e.message || e)).slice(0, 150), 0);
    }
  });
}
