# 生活工具箱（Lifestyle Tool）

只給擁有者一人使用的手機 PWA：信用卡通路推薦、機票、台北／桃園活動、附近店家。
完整規格在 `personal-tools-plan-v2.md`（V2.1，本機檔案，**不進 git**）。實作只依該文件，不參考 V1。

## 架構
- 前端：`docs/`，純 HTML/CSS/ES modules，無建置步驟。GitHub Pages 從 `main` 的 `/docs` 發佈 → https://doublejust.github.io/lifestyle-tool/
- 後端：`apps-script/`（Google Apps Script Web App，執行身分「我」、存取權「所有人」）。目前沒有 clasp，由擁有者把檔案貼進線上編輯器部署。
- 推播：LINE Messaging API（`apps-script/Line.gs`），排程在 `Triggers.gs`（週五 18 點 `weeklyEventsJob`、週日 3 點 `cleanupJob`）。
- repo `DoubleJust/lifestyle-tool` 是**公開**的。

## 必須遵守
1. 日期一律以 `Asia/Taipei` 為準，用 `yyyy-MM-dd` 字串與半開區間 `[start, endExclusive)`。
2. 金鑰、token、LINE user ID、持有卡片清單、真實 API 回應樣本、個人紀錄**一律不 commit**。機密只放 Apps Script 的指令碼屬性。萬一誤 commit：先輪替憑證，再清歷史。
   例外：**公開資料**的精簡測試樣本可以放 `tests/fixtures/`（例如文化部活動 19 筆、只留需要的欄位）；完整的原始回應仍不 commit。
3. 外部資料只用 `textContent` 顯示（用 `docs/js/ui.js` 的 `h()`），**禁止 `innerHTML`**。
4. 後端新功能一律註冊在 `Code.gs` 的 `ACTIONS` 白名單，設定每日 `limit`，並做輸入驗證（失敗丟 `inputError_()`）。所有回應都是 JSON：`{ok:true,data}` 或 `{ok:false,code}`，不回傳 stack 或原始錯誤訊息。
5. 前端呼叫後端一律透過 `docs/js/api.js` 的 `call()`（`Content-Type: text/plain`，不可改成 `application/json`）。
6. 前端資源一律用相對路徑（`./...`），因為網站在 `/lifestyle-tool/` 子路徑下。
7. 所有 LINE push 都要經過 `pushLine_`：KILL_SWITCH、每日 5／每月 150 則上限、用 push_log＋`X-Line-Retry-Key` 去重。
8. 不得把 Google Places 回傳的內容寫進試算表。

## 改版流程
1. 新增前端檔案時，把路徑加進 `docs/sw.js` 的 `SHELL` 清單。
2. 每次要推上 GitHub 的前端變更，先執行 `node tools/bump-version.mjs`（同時更新 `config.js` 的 `APP_VERSION` 與 `sw.js` 的 `CACHE_VERSION`），否則手機上的主畫面 App 不會收到更新。
3. 後端變更：改 `apps-script/` 的檔案並更新 `Code.gs` 的 `BACKEND_VERSION`，請擁有者貼上後用「管理部署作業 → 編輯 → 新版本」部署（**不要**新增部署作業，否則 `/exec` 網址會變）。
4. commit 使用 repo 內設定的 GitHub noreply email（`git config user.email`），不要改成其他信箱。

## 進度（依規劃書 §9）
- 步驟 0 通訊 PoC、步驟 1 PWA 骨架、步驟 2 F1 信用卡：**都已通過 iPhone 驗收**。
- 2026-11-24 完成 UI 改版（前端 1.2.4），擁有者已驗收。
- 2026-11-25 步驟 3（LINE、`runJob_`、F3 活動＋週五推播；前端 1.3.0、後端 1.3.0）：後端已部署，`weeklyEventsJob` 推播 1 則、重跑不重複、觸發器已設定。待擁有者在 iPhone 驗收活動頁與收藏。
  - 活動篩選邏輯：後端 `EventsLib.gs`（純函式，`tests/events.test.mjs` 用 node:vm 載入測試）、前端 `docs/js/lib/events.js`。
  - 左滑移除／收藏存在試算表 `event_prefs`（手機電腦同步）；已移除的活動不出現在查詢與週五推播。
  - 地址沒寫縣市時用行政區名稱判斷，再不行才用經緯度矩形（台北矩形會包到新北，所以只當最後手段）。

## 視覺設計（2026-11-24 擁有者定案，新頁面一律沿用）
- 淺色「柔和圓潤」：奶油色底、白色大圓角區塊、圓形（pill）輸入框與按鈕、圓角底部分頁列，主色橘。
- 深色「純黑細框」：純黑底、深灰區塊；彩色只用在細框、數字和重點標籤。深淺色跟著系統設定（`prefers-color-scheme`），**兩種模式都要檢查**。
- 顏色、圓角一律用 `docs/css/style.css` 的 CSS 變數（`--bg`、`--surface`、`--field`、`--accent`、`--r1-*`～`--r3-*` 等），不要在 JS 或新 CSS 寫死色碼。
- 現成元件：`.card`（區塊）、`button.chip` + `aria-pressed`（單選按鈕）、`.search-row`、`.opts`、`.result.rank-N`（依排名輪流橘／紫／綠）、`.part`、`.tag`（`key` 粗體強調、`bad` 紅字）。
- 擁有者偏好：**資訊要完整**（方案、上限、期限、計算方式都要看得到，不要為了好看而省略）；數字不要放太大（結果的 % 是 26px，太大會「很老人」）。
- 改外觀前先做樣板截圖給擁有者選。樣板可暫放 `docs/_mockups/`（**檔名不可叫 index.html**，會被 SW 當成 App 外殼），截完圖就刪除，不 commit。

## 測試與驗收
- `npm test`（`node --test tests/`）。`tests/data.test.mjs` 用真實資料寫了擁有者的常用情境，改回饋規則時要一起更新。
- 前端改完：測試 → 本機瀏覽器手機尺寸（淺色＋深色）檢查、看 console → bump 版本 → commit、push → 請擁有者在 iPhone 主畫面 App 按「重新載入」驗收。
- 信用卡資料的欄位說明與資料決策紀錄在 `docs/data/README.md`。

## 本機預覽
- `node tools/serve.mjs 8080` → http://localhost:8080/（`.claude/launch.json` 的 `poc` 設定）
- 本機的 service worker 會一直給舊版：測新版前先在 console 執行「unregister 所有 SW、刪除所有 caches，再 `location.reload()`」。只改 hash 不會重新載入頁面。
- 圖示：`node tools/make-icons.mjs` 重新產生 `docs/icons/`
- `docs/poc.html` 是步驟 0 的連線測試頁，保留作除錯用。
