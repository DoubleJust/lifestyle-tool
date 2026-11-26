# 生活工具箱（Lifestyle Tool）

只給擁有者一人使用的手機 PWA：信用卡通路推薦、機票、台北／桃園活動、附近店家。
完整規格在 `personal-tools-plan-v2.md`（V2.1，本機檔案，**不進 git**）。實作只依該文件，不參考 V1。

## 架構
- 前端：`docs/`，純 HTML/CSS/ES modules，無建置步驟。GitHub Pages 從 `main` 的 `/docs` 發佈 → https://doublejust.github.io/lifestyle-tool/
- 後端：`apps-script/`（Google Apps Script Web App，執行身分「我」、存取權「所有人」）。目前沒有 clasp，由擁有者把檔案貼進線上編輯器部署。
- 推播：LINE Messaging API（`apps-script/Line.gs`），排程在 `Triggers.gs`（週五 10 點 `weeklyEventsJob`、每天 6 點 `dailyHealthJob`、週日 3 點 `cleanupJob`）。
- 活動來源：文化部（主要，`Events.gs`）＋臺北旅遊網、桃園觀光行事曆、Accupass、JOIN+1（`SourcesLib.gs` 解析、`Sources.gs` 抓取，每天 6 點由 `dailyHealthJob` 抓一次存進 `extra_cache`）。查詢／推播／收藏都用 `evAllRows_()` 合併，同標題同一天視為重複、以文化部為主。
- 主畫面名稱「Lifestyle Tool」；圖示由 `tools/icon-source.png`（擁有者提供）經 `node tools/make-icons.mjs` 產生。
- repo `DoubleJust/lifestyle-tool` 是**公開**的。

## 必須遵守
1. 日期一律以 `Asia/Taipei` 為準，用 `yyyy-MM-dd` 字串與半開區間 `[start, endExclusive)`。
2. 金鑰、token、LINE user ID、持有卡片清單、真實 API 回應樣本、個人紀錄**一律不 commit**。機密只放 Apps Script 的指令碼屬性。萬一誤 commit：先輪替憑證，再清歷史。
   例外：**公開資料**的精簡測試樣本可以放 `tests/fixtures/`（例如文化部活動 19 筆、只留需要的欄位）；完整的原始回應仍不 commit。
3. 外部資料只用 `textContent` 顯示（用 `docs/js/ui.js` 的 `h()`），**禁止 `innerHTML`**。
4. 後端新功能一律註冊在 `Code.gs` 的 `ACTIONS` 白名單，設定每日 `limit`，並做輸入驗證（失敗丟 `inputError_()`）。所有回應都是 JSON：`{ok:true,data}` 或 `{ok:false,code}`，不回傳 stack 或原始錯誤訊息。
5. 前端呼叫後端一律透過 `docs/js/api.js` 的 `call()`（`Content-Type: text/plain`，不可改成 `application/json`）。
6. 前端資源一律用相對路徑（`./...`），因為網站在 `/lifestyle-tool/` 子路徑下。
7. 所有 LINE push 都要經過 `pushLine_`：KILL_SWITCH、每日 5／每月 50 則上限、用 push_log＋`X-Line-Retry-Key` 去重。
8. 不得把 Google Places 回傳的內容寫進試算表。
9. 爬網頁來源（2026-11-27 擁有者推翻規格 §0「不爬網頁」，只限臺北旅遊網、Accupass、JOIN+1）：每天最多抓一次、每站活動頁有上限；只存標題、時間、地點、價格與連結；一個來源失敗不可影響其他來源，失敗時保留上次的資料並記到 `HEALTH`（App 顯示「到 ○○ 找」的連結、連續 2 天失敗推 1 則 LINE）。網站改版時修 `SourcesLib.gs` 的解析並更新 `tests/fixtures/sources/`。

## 改版流程
1. 新增前端檔案時，把路徑加進 `docs/sw.js` 的 `SHELL` 清單。
2. 每次要推上 GitHub 的前端變更，先執行 `node tools/bump-version.mjs`（同時更新 `config.js` 的 `APP_VERSION` 與 `sw.js` 的 `CACHE_VERSION`），否則手機上的主畫面 App 不會收到更新。
3. 後端變更：改 `apps-script/` 的檔案並更新 `Code.gs` 的 `BACKEND_VERSION`，請擁有者貼上後用「管理部署作業 → 編輯 → 新版本」部署（**不要**新增部署作業，否則 `/exec` 網址會變）。
4. commit 使用 repo 內設定的 GitHub noreply email（`git config user.email`），不要改成其他信箱。

## 進度（依規劃書 §9）
- 步驟 0 通訊 PoC、步驟 1 PWA 骨架、步驟 2 F1 信用卡：**都已通過 iPhone 驗收**。
- 2026-11-24 完成 UI 改版（前端 1.2.4），擁有者已驗收。
- 2026-11-25 步驟 3（LINE、`runJob_`、F3 活動＋週五推播；前端 1.3.0、後端 1.3.0）：**已通過驗收**（推播 1 則、重跑不重複、觸發器已設定；iPhone 活動頁、左滑移除、收藏都 OK）。
- 2026-11-25 前端 1.4.0／後端 1.4.0：
  - 外部 API 健康狀態（`Health.gs`，指令碼屬性 `HEALTH`）：文化部、LINE 每次呼叫都記錄成功／失敗；`dailyHealthJob` 每天抓一次文化部資料（也預熱快取），格式可疑（`evFeedProblem_`）也算異常。App 開啟時最多每 3 小時問 `health`，異常就在上方顯示紅色提示，設定頁有「資料來源狀態」。新增外部 API 時要接 `healthMark_` 並加進 `HEALTH_SOURCES_`。
  - 已結束活動的收藏／移除紀錄由 `dailyHealthJob` 每天自動刪除（`events_cache` 每天覆寫、`log` 留 90 天、`push_log` 留 400 天）。
  - 臺北旅遊網 Open API 有 Cloudflare，Apps Script 被擋（2026-11-25 實測），不採用；Accupass、JOIN+1 沒有公開 API，依規格不爬網頁。
- 2026-11-27 前端 1.5.0／後端 1.5.0：新增四個活動來源（見架構）。觀光署「活動－觀光資訊資料庫」的 ZIP 從 Apps Script 打不開（可能擋國外 IP），未採用；要用的話改走 TDX（需擁有者註冊取得金鑰）。
- 2026-11-27 後端實測：桃園、Accupass、JOIN+1 從 Apps Script 都抓得到；臺北旅遊網被 Cloudflare 擋（403），改為**連結模式**（`HEALTH_SOURCES_` 的 `linkOnly`）：每天照樣試抓，抓不到時狀態是 `link`，活動頁只顯示「到 臺北旅遊網 找」按鈕，不警告、不推 LINE（前端 1.5.1／後端 1.5.1）。
- 2026-11-27 後端 1.5.2：其他來源的活動依標題（＋Accupass 標籤）分類到和文化部相同的類別（`SRC_CATEGORY_RULES_`，由上往下第一個符合的為準），另有市集、運動、美食、節慶、旅遊走讀、聚會交友；用真實資料檢查過，「其他」約 1 成。JOIN+1 的測試活動不收。
- 下一步：步驟 4（F4-A Maps URL）。
  - 活動篩選邏輯：後端 `EventsLib.gs`（純函式，`tests/events.test.mjs` 用 node:vm 載入測試）、前端 `docs/js/lib/events.js`。
  - 左滑移除／收藏存在試算表 `event_prefs`（手機電腦同步）；已移除的活動不出現在查詢與週五推播。
  - 前端本機快取 `docs/js/lib/eventcache.js`（localStorage `lt.events.*`）：查詢結果最多 5 個期間，資料日期是今天就不再呼叫後端；舊資料先顯示再背景更新；收藏／移除狀態超過 30 分鐘在背景和後端同步。
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
