// 統一呼叫後端：自動帶 token、逾時、把錯誤碼轉成中文訊息。
// 用法：const data = await call('ping', { echo: 'hi' });  失敗時丟出 ApiError（有 .code）
import { EXEC_URL, API_TIMEOUT_MS } from './config.js';
import { getToken } from './store.js';

const MESSAGES = {
  NO_TOKEN: '尚未設定 Token，請到「設定」頁輸入。',
  AUTH: 'Token 不正確，請到「設定」頁重新輸入。',
  DISABLED: '後端已暫停服務（KILL_SWITCH 已開啟）。',
  RATE: '這個功能今天的使用次數已達上限，明天會自動恢復。',
  BAD_ACTION: '後端不認得這個功能，可能還沒部署新版本。',
  BAD_INPUT: '輸入的資料有誤，請檢查後再試。',
  BAD_JSON: '送出的資料格式錯誤。',
  TOO_LARGE: '送出的資料太大。',
  INTERNAL: '後端發生錯誤，詳細內容請看 Apps Script 執行記錄。',
  TIMEOUT: '連線逾時，請稍後再試。',
  NETWORK: '無法連線，請檢查網路。',
  BAD_RESPONSE: '後端回應格式不正確，可能是部署設定有誤。'
};

export class ApiError extends Error {
  constructor(code, extra = {}) {
    super(messageFor(code));
    this.name = 'ApiError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export function messageFor(code) {
  return MESSAGES[code] || `發生未預期的錯誤（${code}）。`;
}

/**
 * @param {string} action 後端白名單中的 action 名稱
 * @param {object} params 參數
 * @param {{token?: string, timeoutMs?: number}} opts token 可覆寫（設定頁測試新 token 用）
 * @returns {Promise<any>} 後端回傳的 data
 */
export async function call(action, params = {}, opts = {}) {
  const token = opts.token ?? getToken();
  if (!token) throw new ApiError('NO_TOKEN');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? API_TIMEOUT_MS);
  let text;
  try {
    const res = await fetch(EXEC_URL, {
      method: 'POST',
      // 必須是 text/plain：application/json 會觸發 CORS preflight，Apps Script 不支援
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, action, params }),
      redirect: 'follow',
      signal: ctrl.signal
    });
    text = await res.text();
  } catch (err) {
    throw new ApiError(err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
  } finally {
    clearTimeout(timer);
  }

  let json;
  try { json = JSON.parse(text); } catch { throw new ApiError('BAD_RESPONSE'); }
  if (!json || typeof json !== 'object') throw new ApiError('BAD_RESPONSE');
  if (json.ok !== true) throw new ApiError(json.code || 'BAD_RESPONSE', { field: json.field });
  return json.data;
}
