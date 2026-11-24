/** 共用工具：回應、日期、配額、輸入驗證、機密遮罩 */

const TZ_ = 'Asia/Taipei';

function reply_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

/** 台北時區的 yyyy-MM-dd */
function ymd_(date) {
  return Utilities.formatDate(date, TZ_, 'yyyy-MM-dd');
}

/** 純日期加減，避免時區換算出錯 */
function addDays_(ymd, n) {
  const parts = ymd.split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + n)).toISOString().slice(0, 10);
}

/**
 * 每日配額：每個 action 一個屬性 rl_<action> = {"d":"2026-11-22","n":3}，換日自動歸零，不會累積舊資料。
 * 刻意不上鎖：單人使用下，極少數同時請求頂多讓計數差 1～2 次；
 * 上鎖反而會在排程工作持有 script lock 時卡住手動查詢。
 */
function consumeQuota_(action, limit) {
  const props = PropertiesService.getScriptProperties();
  const key = 'rl_' + action;
  const today = ymd_(new Date());
  let rec = null;
  try { rec = JSON.parse(props.getProperty(key) || 'null'); } catch (e) { rec = null; }
  if (!rec || rec.d !== today) rec = { d: today, n: 0 };
  if (rec.n >= limit) return false;
  rec.n += 1;
  props.setProperty(key, JSON.stringify(rec));
  return true;
}

/** 輸入驗證失敗時丟出，doPost 會轉成 BAD_INPUT */
function inputError_(field, message) {
  const err = new Error(message || ('invalid ' + field));
  err.name = 'InputError';
  err.field = field;
  return err;
}

/** 資源忙碌（例如排程工作正在更新快取）時丟出，doPost 會轉成 BUSY */
function busyError_() {
  const err = new Error('busy');
  err.name = 'BusyError';
  return err;
}

/** 遮罩：先把實際機密值逐一換掉（最可靠），再處理常見格式 */
function sanitize_(s) {
  const props = PropertiesService.getScriptProperties().getProperties();
  ['APP_TOKEN', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_USER_ID', 'PLACES_API_KEY'].forEach(function (k) {
    const v = props[k];
    if (v && v.length >= 6) s = s.split(v).join('***');
  });
  return s
    .replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer ***')
    .replace(/("?(?:api[_-]?key|key|token|authorization)"?\s*[:=]\s*"?)[^\s"&,}]+/gi, '$1***');
}
