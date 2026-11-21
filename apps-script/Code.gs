/**
 * 步驟 0：通訊 PoC 後端
 * 只做三件事：驗證 token、回 JSON、出錯時仍回 JSON（不洩漏內部訊息）。
 *
 * 使用方式：
 *  1. 第一次先手動執行 setupToken()，到「執行記錄」複製產生的 token。
 *  2. 部署 → 新增部署作業 → 類型「網頁應用程式」
 *     執行身分：我　／　誰可以存取：所有人（Anyone）
 */

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > 10240) return json_({ ok: false, code: 'TOO_LARGE' });

    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch (parseErr) {
      return json_({ ok: false, code: 'BAD_JSON' });
    }

    const expected = PropertiesService.getScriptProperties().getProperty('APP_TOKEN');
    if (!expected || typeof body.token !== 'string' || body.token !== expected) {
      return json_({ ok: false, code: 'AUTH' });
    }

    switch (body.action) {
      case 'ping':
        return json_({
          ok: true,
          echo: typeof body.echo === 'string' ? body.echo.slice(0, 200) : null,
          now: Utilities.formatDate(new Date(), 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ssXXX"),
          tz: Session.getScriptTimeZone()
        });
      case 'throw':
        // 故意丟出含機密的錯誤，驗證前端只會收到通用的錯誤碼
        throw new Error('intentional test error, token=' + expected);
      default:
        return json_({ ok: false, code: 'BAD_ACTION' });
    }
  } catch (err) {
    console.error('doPost failed: ' + (err && err.name)); // 不把 message 寫進 log，避免含機密
    return json_({ ok: false, code: 'INTERNAL' });
  }
}

/** 用瀏覽器直接打開 /exec 時的回應，方便確認部署是否成功 */
function doGet() {
  return json_({ ok: true, hint: 'POST only' });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 手動執行一次：產生 64 字元隨機 token 存入指令碼屬性，並印在執行記錄裡讓你複製 */
function setupToken() {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('APP_TOKEN', token);
  console.log('APP_TOKEN = ' + token);
}
