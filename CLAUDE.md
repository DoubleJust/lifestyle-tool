# 生活工具箱（Lifestyle Tool）

只給擁有者一人使用的手機 PWA：信用卡通路推薦、機票、台北／桃園活動、附近店家。
完整規格在 `personal-tools-plan-v2.md`（V2.1，本機檔案，**不進 git**）。實作只依該文件，不參考 V1。

## 架構
- 前端：`docs/`，純 HTML/CSS/ES modules，無建置步驟。GitHub Pages 從 `main` 的 `/docs` 發佈 → https://doublejust.github.io/lifestyle-tool/
- 後端：`apps-script/`（Google Apps Script Web App，執行身分「我」、存取權「所有人」）。目前沒有 clasp，由擁有者把檔案貼進線上編輯器部署。
- 推播：LINE Messaging API（之後的步驟）。
- repo `DoubleJust/lifestyle-tool` 是**公開**的。

## 必須遵守
1. 日期一律以 `Asia/Taipei` 為準，用 `yyyy-MM-dd` 字串與半開區間 `[start, endExclusive)`。
2. 金鑰、token、LINE user ID、持有卡片清單、真實 API 回應樣本、個人紀錄**一律不 commit**。機密只放 Apps Script 的指令碼屬性。萬一誤 commit：先輪替憑證，再清歷史。
3. 外部資料只用 `textContent` 顯示（用 `docs/js/ui.js` 的 `h()`），**禁止 `innerHTML`**。
4. 後端新功能一律註冊在 `Code.gs` 的 `ACTIONS` 白名單，設定每日 `limit`，並做輸入驗證（失敗丟 `inputError_()`）。所有回應都是 JSON：`{ok:true,data}` 或 `{ok:false,code}`，不回傳 stack 或原始錯誤訊息。
5. 前端呼叫後端一律透過 `docs/js/api.js` 的 `call()`（`Content-Type: text/plain`，不可改成 `application/json`）。
6. 前端資源一律用相對路徑（`./...`），因為網站在 `/lifestyle-tool/` 子路徑下。
7. 所有 LINE push 都要經過 `pushLine_`：檢查每日／每月上限並用 push_log 去重（步驟 3 實作）。
8. 不得把 Google Places 回傳的內容寫進試算表。

## 改版流程
1. 新增前端檔案時，把路徑加進 `docs/sw.js` 的 `SHELL` 清單。
2. 每次要推上 GitHub 的前端變更，先執行 `node tools/bump-version.mjs`（同時更新 `config.js` 的 `APP_VERSION` 與 `sw.js` 的 `CACHE_VERSION`），否則手機上的主畫面 App 不會收到更新。
3. 後端變更：改 `apps-script/` 的檔案並更新 `Code.gs` 的 `BACKEND_VERSION`，請擁有者貼上後用「管理部署作業 → 編輯 → 新版本」部署（**不要**新增部署作業，否則 `/exec` 網址會變）。
4. commit 使用 repo 內設定的 GitHub noreply email（`git config user.email`），不要改成其他信箱。

## 本機預覽
- `node tools/serve.mjs 8080` → http://localhost:8080/（`.claude/launch.json` 的 `poc` 設定）
- 圖示：`node tools/make-icons.mjs` 重新產生 `docs/icons/`
- `docs/poc.html` 是步驟 0 的連線測試頁，保留作除錯用。
