// Service worker 註冊與「有新版本」提示。
// 流程：部署時 sw.js 的 CACHE_VERSION 改變 → 瀏覽器安裝新 SW 並在 waiting 狀態等候
//       → 顯示提示列 → 使用者按「重新載入」→ 新 SW 接手 → 頁面重新整理。

let registration = null;

export function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const banner = document.getElementById('update-banner');
  const applyBtn = document.getElementById('update-apply');

  const showUpdate = (worker) => {
    banner.hidden = false;
    applyBtn.onclick = () => {
      applyBtn.disabled = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    };
  };

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        // 有舊版在控制頁面時才提示；第一次安裝不用提示
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(worker);
      });
    });
    // App 從背景切回前景時檢查更新（主畫面 App 常常只是被喚醒，不會重新載入）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch((err) => console.warn('SW 註冊失敗', err));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

/** 設定頁「檢查更新」用。回傳 'unsupported' | 'checking-done' | 'waiting' */
export async function checkForUpdate() {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const reg = registration || await navigator.serviceWorker.getRegistration();
  if (!reg) return 'unsupported';
  await reg.update();
  // 新版正在下載時，等它裝完再回報，否則會誤報「已是最新」
  const worker = reg.installing;
  if (worker) {
    await new Promise((resolve) => {
      const done = () => {
        if (worker.state === 'installing') return;
        worker.removeEventListener('statechange', done);
        resolve();
      };
      worker.addEventListener('statechange', done);
      done();
    });
  }
  return reg.waiting ? 'waiting' : 'checking-done';
}
