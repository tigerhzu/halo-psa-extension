# HaloPSA Writing Helper

Chrome Manifest V3 擴充功能，協助 HaloPSA 使用者撰寫 Activity Note、整理工單、調整 Timesheet 與自訂工作介面。

## 安裝

1. 從 [GitHub Releases](https://github.com/tigerhzu/halo-psa-extension/releases/latest) 下載最新的 `halo-psa-extension-*.zip` 並解壓縮。
2. 開啟 Chrome 的 `chrome://extensions`。
3. 開啟右上角的「開發人員模式」。
4. 選擇「載入未封裝項目」，指定剛解壓縮的資料夾。
5. 重新整理 HaloPSA 頁面後即可使用。

> 此擴充功能只會在 HaloPSA 網域載入。AI 服務提供者與自訂設定會保存在瀏覽器本機的 extension storage。

首次登入預設外觀為 Cute，使用純黑 Accent（`#000000`），簡單模式預設關閉；之後使用者在設定面板選擇的主題、顏色與模式會保存在 `chrome.storage.local`，不會被重新登入覆蓋。

## 首次登入提示

首次在 HaloPSA 載入 Extension 時，會在獨立的 Extension 分頁開啟「首次登入提示」，不會把精靈疊在 HaloPSA 頁面上。內容包含三個步驟：

1. 選擇簡單模式要保留的 Team；Op Team A、B、C、Other Support、Project Manager、SecOp Team A、Technical Solutions Division、RD、Thailand Team 與 Sales&Admin 都可以個別選擇，只會顯示勾選的 Team。
2. 選擇 Azure OpenAI 或 Google Gemini，並視需要填入 API 資訊。
3. 設定「永遠 CC 收件人」，所有文件自動 cc。

三個步驟都可略過。完成或關閉後，可由 HaloPSA 浮動設定面板的 `設定` 進入完整設定頁，再開啟「首次登入提示」；設定只保存在 `chrome.storage.local`。若瀏覽器暫時無法開啟獨立分頁，Extension 會回退成內嵌精靈，並先隱藏摯友工具列避免遮擋。

## v0.9.3 重點功能

- 新增左下角固定控制列：`mode`、`color`、`pet` 與 `settings` 可在任何 HaloPSA 頁面快速操作。
- 寵物設定改為獨立選單；點選寵物後立即套用、保存並關閉選單。寵物會跟隨頁面顯示，Quick Links 面板會依寵物左右側與視窗邊界自動定位。
- Quick Links 改為卡片式管理介面：可新增、編輯、刪除與上下拖曳排序，順序會立即保存；編輯欄位會自動維持在視窗可見範圍內。
- Quick Links 介面移除多餘說明文字與前方箭頭圖示，保留簡潔的快捷按鈕與 URL 資訊。
- Cute 模式在獨立 Note 編輯頁會正確沿用 Cute 介面，不會退回預設 AI 按鈕。
- 主題選單顯示「果凍」與「預設」；主題、Accent 顏色、寵物與簡單模式均可即時套用並保存。
- 簡單模式保留使用者選定的 Team，切換到 Tickets、Timesheets 或其他 Team 後仍維持同一份選擇。
- 完全移除「整理格式」功能，避免在工具列、編輯器與預覽介面留下已停用的按鈕。
- 完整設定頁提供一鍵匯出／匯入，可選擇是否包含 API Key；不含 API Key 的設定檔適合安全分享或備份。
- 首次登入提示、Team 白名單、自訂 Accent、永遠 CC 與既有 AI／Timesheet 功能持續保留。

- 簡單模式的 More 選單會保留 `Final Check with Customer/Sales`。
- 完成 Final Check 後，HaloPSA 原生的 `Resolve Ticket`／`Resolved Ticket` 按鈕仍可使用。
- Team A、Team B、Team C 與 Timesheets Sidebar 使用新版星河圖示。
- New Ticket 使用 Halo 原生編輯工具列；Extension 自己的 AI／範本工具列只在 New Ticket 隱藏，一般 Ticket 與 Activity Note 不受影響。
- Ticket 詳情頁右上角的上一筆、開新視窗、分享、列印與其他 utility actions 會在簡單模式隱藏；主要 Ticket status actions 仍保留。
- Color 區提供原生調色盤；可選任意自訂 Accent 顏色，設定會保存並即時套用到 Extension UI。

## 簡單模式介紹（Simple Mode）

> 設定頁顯示的「簡單模式」就是本擴充功能的專注工作介面，不需要另外安裝。

簡單模式會在不改寫 HaloPSA API、不刪除原始 DOM 的前提下，隱藏不常用的原生 UI。設定會保存在 `chrome.storage.local`，切換後立即套用；重新整理 HaloPSA 後也會保留使用者選擇。

### 開啟與關閉

1. 開啟 Extension 的設定頁，或點選 HaloPSA 右下角寵物開啟浮動設定面板。
2. 將「簡單模式」切換為 ON，即時套用專注介面。
3. 切換為 OFF，所有由 Extension 隱藏的 HaloPSA 元件會完整恢復；不需要重新整理頁面。

### 保留的日常功能

- 左側保留 Timesheets 與設定清單中的 Team：預設包含 Op Team A、Op Team B、Op Team C、Other Support、Project Manager、SecOp Team A、Technical Solutions Division、RD、Thailand Team、Sales&Admin；Team 底下的 Unassigned、工程師、Ticket 數量與展開／收合均使用 HaloPSA 原生功能。
- Timesheets 頁會依簡單模式目前保留的 Team 清單建立返回捷徑，順序與設定相同；點擊後沿用原生 Team 導覽。
- Ticket 上方保留 Re-Assign、First Contact、Pending、In Progress、On Hold、Postponed、Awaiting Customer、Vendor Processing 與 More。
- More 選單保留 Email User、Activity Note、Final Check with Customer/Sales。完成 Final Check 後，保留 Resolve Ticket／Resolved Ticket。
- Ticket Information 僅顯示 Date Created、Created By、Ticket Type、Status、Team、Assigned Agent、Additional Agents、Time Recorded、Impact、Category。
- End-User Details 僅顯示 User、Top Level、Client、Site、Email Address、Phone Number、Site Phone Number。
- 簡單模式會在確認頁首簽章後隱藏右上角 Halo 原生工具按鈕，保留 New Ticket；找不到可靠 DOM 簽章時會跳過該區塊並記錄 warning。

### 安全性與相容性

- 簡單模式只會加入可逆的 CSS class，不會刪除 HaloPSA 節點，也不會自行呼叫 Ticket Status API。
- HaloPSA 是 SPA；切換 Ticket、Team、Timesheets 或返回頁面後，模式會重新套用。
- Activity Note 獨立視窗、Quick Link、Cute 主題、AI 與寵物等既有 Extension 功能會維持可用。
- 若某個 HaloPSA 元件因版本更新而找不到，該區塊會略過，不會中斷其他 Extension 功能；將簡單模式關閉即可隨時回到原始介面。

## v0.9.0 重點功能

- 客戶版 AI：固定為「您好〔姓名〕，／正文／謝謝。」格式；姓名只會在原文明確可辨識時帶入。
- 工單版 AI：每一項都整理成條列，並依語意為短標籤上色；技術值、錯誤碼、IP 與網址保持原色。
- Activity Note 獨立編輯器：可選取圖片後直接拖曳右下角調整大小，也保留手動輸入寬度功能。
- 快速範本：修正 Cute 主題下無法點選的問題，並支援可靠插入至 HaloPSA 編輯器。
- Timesheet：移除自動時間對齊；手動調整時間與重疊時段互不阻擋，並加強寫回 HaloPSA 的可靠性。
- 寵物：內建 Claude Crab，並支援將符合格式的自訂寵物放到 `pet/<pet-id>/` 後自動辨識。
- 設定面板：可新增、編輯與刪除自訂 URL 捷徑按鈕；後續版本已將管理介面移至浮動寵物的 Quick Links 面板。

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
