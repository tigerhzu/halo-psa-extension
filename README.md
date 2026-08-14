# HaloPSA Writing Helper

Chrome Manifest V3 擴充功能，協助 HaloPSA 使用者撰寫 Activity Note、整理工單、調整 Timesheet 與自訂工作介面。

## 安裝

1. 從 GitHub Releases 下載最新的 `halo-psa-extension-*.zip` 並解壓縮。
2. 開啟 Chrome 的 `chrome://extensions`。
3. 開啟右上角的「開發人員模式」。
4. 選擇「載入未封裝項目」，指定剛解壓縮的資料夾。
5. 重新整理 HaloPSA 頁面後即可使用。

> 此擴充功能只會在 HaloPSA 網域載入。AI 服務提供者與自訂設定會保存在瀏覽器本機的 extension storage。

## v0.9.2 重點功能

- 極致模式的 More 選單會保留 `Final Check with Customer/Sales`。
- 完成 Final Check 後，HaloPSA 原生的 `Resolve Ticket`／`Resolved Ticket` 按鈕仍可使用。
- Team A、Team B、Team C 與 Timesheets Sidebar 使用新版星河圖示。

## Future 模式介紹（極致模式／Ultimate Mode）

> README 中的「Future 模式」指的就是設定頁顯示的「極致模式（Ultimate Mode）」；它是同一個專注工作介面功能，不需要另外安裝。

極致模式會在不改寫 HaloPSA API、不刪除原始 DOM 的前提下，隱藏不常用的原生 UI。設定會保存在 `chrome.storage.local`，切換後立即套用；重新整理 HaloPSA 後也會保留使用者選擇。

### 開啟與關閉

1. 開啟 Extension 的設定頁，或點選 HaloPSA 右下角寵物開啟浮動設定面板。
2. 將「極致模式」切換為 ON，即時套用專注介面。
3. 切換為 OFF，所有由 Extension 隱藏的 HaloPSA 元件會完整恢復；不需要重新整理頁面。

### 保留的日常功能

- 左側保留 Timesheets、Op Team A、Op Team B、Op Team C；Team 底下的 Unassigned、工程師、Ticket 數量與展開／收合均使用 HaloPSA 原生功能。
- Timesheets 頁提供 Team A／B／C 返回捷徑，點擊後沿用原生 Team 導覽。
- Ticket 上方保留 Re-Assign、First Contact、Pending、In Progress、On Hold、Postponed、Awaiting Customer、Vendor Processing 與 More。
- More 選單保留 Email User、Activity Note、Final Check with Customer/Sales。完成 Final Check 後，保留 Resolve Ticket／Resolved Ticket。
- Ticket Information 僅顯示 Date Created、Created By、Ticket Type、Status、Team、Assigned Agent、Additional Agents、Time Recorded、Impact、Category。
- End-User Details 僅顯示 User、Top Level、Client、Site、Email Address、Phone Number、Site Phone Number。

### 安全性與相容性

- 極致模式只會加入可逆的 CSS class，不會刪除 HaloPSA 節點，也不會自行呼叫 Ticket Status API。
- HaloPSA 是 SPA；切換 Ticket、Team、Timesheets 或返回頁面後，模式會重新套用。
- Activity Note 獨立視窗、Quick Link、Cute 主題、排版功能與寵物等既有 Extension 功能會維持可用。
- 若某個 HaloPSA 元件因版本更新而找不到，該區塊會略過，不會中斷其他 Extension 功能；將極致模式關閉即可隨時回到原始介面。

## v0.9.0 重點功能

- 客戶版 AI：固定為「您好〔姓名〕，／正文／謝謝。」格式；姓名只會在原文明確可辨識時帶入。
- 工單版 AI：每一項都整理成條列，並依語意為短標籤上色；技術值、錯誤碼、IP 與網址保持原色。
- Activity Note 獨立編輯器：可選取圖片後直接拖曳右下角調整大小，也保留手動輸入寬度功能。
- 快速範本：修正 Cute 主題下無法點選的問題，並支援可靠插入至 HaloPSA 編輯器。
- Timesheet：移除自動時間對齊；手動調整時間與重疊時段互不阻擋，並加強寫回 HaloPSA 的可靠性。
- 寵物：內建 Claude Crab，並支援將符合格式的自訂寵物放到 `pet/<pet-id>/` 後自動辨識。
- 設定面板：可新增、編輯與刪除自訂 URL 捷徑按鈕。

## 工單顏色規則

工單板只會替 `【標籤】` 上色，不會把整句或技術資料染色：

| 顏色 | 標籤用途 |
| --- | --- |
| 紅色 | 異常、失敗、阻斷 |
| 橘色 | 待確認、注意、風險 |
| 藍色 | 資訊、設定、處理動作 |
| 綠色 | 確認結果、已完成 |
| 紫色 | 使用者回報、負責單位 |

## 自訂寵物

將寵物放入下列結構後，重新載入擴充功能即可在設定面板選擇：

```text
pet/
  my-pet/
    pet.json
    spritesheet.webp
```

請參考 [pet/README.md](pet/README.md) 的格式說明。內建 Claude Crab 會作為新安裝時的預設寵物。

## 開發與驗證

本專案不依賴 bundler。提交或發佈前請執行：

```powershell
# JavaScript 語法
rg --files -g '*.js' | ForEach-Object { node --check $_ }

# 自動測試
Get-ChildItem tests -Filter '*.test.js' | ForEach-Object { node $_.FullName }

# 產出可發佈 ZIP（工作區乾淨時）
.\tools\package.ps1
```

## 安全性

- 不提交 API Key、Token、HAR、瀏覽器 session 或私人評測資料。
- AI Key 只存於本機 extension storage，請勿將設定匯出到公開儲存庫。
- ZIP 僅包含 extension runtime 所需的 `manifest.json`、`src/`、`assets/` 與 `pet/`。

## 授權與回報

請透過 GitHub Issues 回報 HaloPSA 版面變更、功能問題或改善建議。
