# 信用卡資料格式

三個檔案都會公開在 GitHub。**只放銀行公開的優惠規則**，不要放卡號、帳單、消費紀錄。
「我持有哪些卡」不放這裡，放在 Google 試算表的 `my_cards` 工作表。

## cards.json
| 欄位 | 說明 |
|---|---|
| `card_id` | 唯一代號，英數與底線，例如 `cathay_cube` |
| `bank` | 銀行名稱 |
| `name` | 卡片名稱 |
| `rounding` | 每筆回饋怎麼取整：`floor` 逐筆無條件捨去（台新 Richart）、`round` 逐筆四捨五入到個位（街口卡）、`none` 不逐筆取整（大戶卡依整月帳單合計） |
| `rounding_note` | 計算方式說明，顯示在結果卡片下方 |
| `exclusions[]` | 銀行的「不回饋項目」（merchant 或類別 id），套用到這張卡的所有規則；但規則的 `merchants[]` 明確列出該店時不套用（官方例外，例：台新Pay 在 7-11） |
| `exclusions_url` | 官方不回饋項目頁面 |

## merchants.json
- `categories`：類別清單 `{ id, name }`。
- `merchants`：`{ id, name, aliases[], categories[] }`。比對時不分大小寫、全半形，「臺」視同「台」。

## rewards.json — `rules[]`
| 欄位 | 必填 | 說明 |
|---|---|---|
| `rule_id` | ✔ | 唯一代號 |
| `card_id` | ✔ | 對應 cards.json |
| `name` | ✔ | 顯示名稱，例如「超市加碼」 |
| `valid_from` / `valid_until` | | `yyyy-MM-dd`，含當天；不填代表不限 |
| `conditions.merchant_categories[]` | | 適用類別；和 `merchants[]` 都沒填 = 一般消費（所有店都適用） |
| `conditions.merchants[]` | | 指定通路（merchant id） |
| `conditions.payment_methods[]` | | 限定支付方式，見下表 |
| `conditions.registration_required` / `registration_url` | | 需登錄 |
| `conditions.min_spend` | | 單筆最低消費，未達則回饋算 0 |
| `conditions.new_cardholder_only` | | 限新戶；預設不列入計算 |
| `reward.rate` | ✔ | 回饋率，3% 寫 `0.03` |
| `reward.type` | ✔ | `cash` 現金／`points` 點數／`discount` 折抵 |
| `reward.point_value` | | 點數換算成多少元，預設 1 |
| `reward.cap` | | 每期**回饋金額**上限（元） |
| `reward.spend_cap` | | 每期**消費金額**上限（元），超過部分不回饋。例：街口卡 400,000 |
| `reward.cap_period` | | 上限週期 `month`／`quarter`／`year`／`campaign` |
| `reward.no_cap` | | `true` 時顯示「無上限」 |
| `plan` | | 需切換的方案名稱（例：Richart 的「Chill刷」），會顯示成標籤 |
| `notes[]` | | 額外說明，各顯示成一個標籤 |
| `conditions.holiday_only` | | 僅國定假日適用（頁面上勾「今天是國定假日」才計入） |
| `stacking_group` | | 同一張卡同群組取最高，不同群組相加。例：一般 1% 放 `base`、加碼 2% 放 `bonus` |
| `exclusions[]` | | 排除的 merchant id 或類別 id |
| `priority` | | 同分時排序用，越大越前面 |
| `source_url` | | 官方活動頁 |
| `last_verified` | | 最後核對日；超過 90 天會提示 |
| `enabled` | | 設 `false` 可暫時停用 |

### 支付方式代碼
`physical` 實體卡、`apple_pay`、`google_pay`、`samsung_pay`、`line_pay`、`taishin_pay` 台新 Pay、`jko_pay` 街口、`pi_wallet` Pi 拍錢包、`taiwan_pay` 台灣 Pay、`online` 網路刷卡

## 計算方式
- 同一張卡：同 `stacking_group` 取最高，不同群組相加；再依卡片的 `rounding` 取整，得到「這一筆實際拿到的回饋」。
- 排序依實際拿到的回饋；相同時依 `cards.json` 的順序（擁有者指定：台新 Richart → 街口卡 → 大戶卡）。
- 顯示的 % 是方案回饋率（取整前），取整造成的差額另外用標籤說明。
- 店名比對到 2 個以上通路時，畫面列出按鈕讓使用者選。

## 資料決策紀錄（改規則前先看）
| 日期 | 決策 | 原因 |
|---|---|---|
| 2026-11-22 | Richart LINE Pay 10–12 月領券加碼 1.5% **不建模** | 限回饋一次，擁有者已用過 |
| 2026-11-23 | 台新兩張卡的 `exclusions` 依台新「信用卡權益不回饋消費項目」頁；大戶卡依擁有者提供的一般消費不回饋項目 | 官方規定；規則明確列出的店（例：台新Pay 在 7-11）優先 |
| 2026-11-23 | 大戶卡拆成基本 1%／國外 2%（無上限）＋任務加碼 2.5%（每月回饋上限 NT$400）＋悠遊卡自動加值 3%（上限 NT$100），以「大戶等級」計算 | 永豐 DAWHO 官網；回饋依整月帳單合計，不逐筆取整 |
| 2026-11-23 | Richart 逐筆小數捨去、街口卡逐筆四捨五入到個位 | 擁有者提供的銀行規則 |
| 2026-11-23 | Pay著刷 台新Pay：萊爾富、OK 超商**維持 3.8%** | 兩份官方資料矛盾（公告寫四大超商、不回饋清單只例外 7-11／全家），擁有者決定 |
| 2026-11-23 | Pay著刷 台新Pay 的通路＝台新Pay「合作通路」頁上的全部商店，但**全聯／大全聯除外** | 擁有者確認；全聯在不回饋清單中「各種支付方式」都不回饋 |
| 2026-11-23 | 麥當勞、全國電子只有用**台灣Pay（TWQR）**付款才算 Pay著刷 | 不在台新Pay 掃碼合作清單，只在台灣Pay／TWQR 區塊 |
