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
