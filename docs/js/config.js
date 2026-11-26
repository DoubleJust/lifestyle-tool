// 前端設定。這個檔案會公開在 GitHub，所以只能放「可公開」的值。
// token 不放這裡：每台裝置在「設定」頁輸入，存在該裝置的 localStorage。

// 版本號：改版時執行 `node tools/bump-version.mjs`，會同時更新這裡和 sw.js
export const APP_VERSION = '1.5.0';

// Apps Script Web App 網址。重新部署時請用「管理部署作業 → 編輯 → 新版本」，網址才不會變。
export const EXEC_URL = 'https://script.google.com/macros/s/AKfycby2kkGvUL_xEIa0zHyuTIbueouVqjDtiyiHCQLvMjQaC4v5QGuCMtSy8E_G1MpyBiGQmg/exec';

export const API_TIMEOUT_MS = 15000;
