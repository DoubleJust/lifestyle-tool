import { h, card, setStatus, isStandalone, isIOS } from '../ui.js';
import { call, ApiError } from '../api.js';
import { getToken, setToken, clearToken } from '../store.js';
import { APP_VERSION } from '../config.js';
import { checkForUpdate } from '../sw-client.js';

export function mount(view) {
  view.append(tokenSection(), installSection(), aboutSection());
}

// ── 後端連線 ──────────────────────────────────────────
function tokenSection() {
  const saved = getToken();
  const input = h('input', {
    id: 'token', type: 'password', autocomplete: 'off', autocapitalize: 'off',
    spellcheck: 'false', placeholder: saved ? '已設定（輸入新的會取代）' : '貼上 APP_TOKEN'
  });
  const status = h('p', { class: 'status', role: 'status' });
  const info = h('dl', { class: 'kv', hidden: true });

  const showInput = h('button', { type: 'button', onclick: () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    showInput.textContent = show ? '隱藏' : '顯示';
  } }, '顯示');

  const saveBtn = h('button', { type: 'button', class: 'primary', onclick: async () => {
    const t = input.value.trim();
    if (!t) { setStatus(status, '請先貼上 token。', 'warn'); return; }
    // 先用新 token 測試，通過才儲存，避免存到打錯的 token
    await runPing(t, { onOk: () => {
      setToken(t);
      input.value = '';
      input.placeholder = '已設定（輸入新的會取代）';
      clearBtn.disabled = false;
      return '已儲存並連線成功';
    } });
  } }, '儲存並測試');

  const testBtn = h('button', { type: 'button', onclick: () => runPing(getToken(), {}) }, '測試連線');

  const clearBtn = h('button', { type: 'button', disabled: !saved, onclick: () => {
    clearToken();
    input.placeholder = '貼上 APP_TOKEN';
    clearBtn.disabled = true;
    info.hidden = true;
    setStatus(status, '已清除這台裝置上的 token。', '');
  } }, '清除');

  async function runPing(token, { onOk }) {
    if (!token) { setStatus(status, '尚未設定 token。', 'warn'); return; }
    [saveBtn, testBtn].forEach((b) => { b.disabled = true; });
    setStatus(status, '連線中…', '');
    info.hidden = true;
    const t0 = performance.now();
    try {
      const data = await call('ping', {}, { token });
      const ms = Math.round(performance.now() - t0);
      const msg = onOk ? onOk() : '連線成功';
      setStatus(status, `${msg}（${ms} ms）`, 'ok');
      info.replaceChildren(
        h('dt', {}, '後端版本'), h('dd', {}, data?.version ?? '—'),
        h('dt', {}, '後端時間'), h('dd', {}, data?.now ?? '—'),
        h('dt', {}, '時區'), h('dd', {}, data?.tz ?? '—')
      );
      info.hidden = false;
    } catch (err) {
      setStatus(status, err instanceof ApiError ? err.message : `發生錯誤：${err.message}`, 'bad');
    } finally {
      [saveBtn, testBtn].forEach((b) => { b.disabled = false; });
    }
  }

  return card('後端連線',
    h('p', { class: 'muted' }, 'Token 只存在這台裝置。iPhone 主畫面 App 和 Safari 的資料互不共用，各自要輸入一次。'),
    h('label', { for: 'token' }, 'APP_TOKEN'),
    input,
    h('div', { class: 'row' }, saveBtn, testBtn, showInput, clearBtn),
    status,
    info
  );
}

// ── 加到主畫面 ────────────────────────────────────────
function installSection() {
  if (isStandalone()) {
    return card('主畫面 App', h('p', { class: 'status ok' }, '目前正以主畫面 App 執行。'));
  }
  if (isIOS()) {
    return card('加到 iPhone 主畫面',
      h('ol', { class: 'steps' },
        h('li', {}, '用 Safari 開啟這個網址。'),
        h('li', {}, '點下方工具列的「分享」按鈕。'),
        h('li', {}, '選「加入主畫面」，再按「新增」。'),
        h('li', {}, '之後從主畫面的「工具箱」圖示開啟，並在設定頁輸入一次 token。')
      )
    );
  }
  return card('安裝成 App',
    h('p', { class: 'muted' }, '電腦版 Chrome／Edge 可以點網址列右側的「安裝」圖示；iPhone 請用 Safari 的「分享 → 加入主畫面」。')
  );
}

// ── 關於與更新 ────────────────────────────────────────
function aboutSection() {
  const status = h('p', { class: 'status', role: 'status' });
  const persisted = h('dd', {}, '檢查中…');
  navigator.storage?.persisted?.()
    .then((p) => { persisted.textContent = p ? '已保護（不會被自動清除）' : '未保護（長期不用可能被清除）'; })
    .catch(() => { persisted.textContent = '無法判斷'; });
  if (!navigator.storage?.persisted) persisted.textContent = '此瀏覽器不支援';

  const btn = h('button', { type: 'button', onclick: async () => {
    btn.disabled = true;
    setStatus(status, '檢查中…', '');
    try {
      const r = await checkForUpdate();
      if (r === 'waiting') setStatus(status, '發現新版本，請按畫面上方的「重新載入」。', 'ok');
      else if (r === 'unsupported') setStatus(status, '此瀏覽器不支援自動更新。', 'warn');
      else setStatus(status, '目前已是最新版本。', 'ok');
    } catch {
      setStatus(status, '檢查失敗，請確認網路。', 'bad');
    } finally {
      btn.disabled = false;
    }
  } }, '檢查更新');

  return card('關於',
    h('dl', { class: 'kv' },
      h('dt', {}, '前端版本'), h('dd', {}, APP_VERSION),
      h('dt', {}, '執行模式'), h('dd', {}, isStandalone() ? '主畫面 App' : '瀏覽器分頁'),
      h('dt', {}, '本機資料'), persisted
    ),
    h('div', { class: 'row' }, btn),
    status
  );
}
