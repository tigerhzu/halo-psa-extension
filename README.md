# HaloPSA Writing Helper

Chrome Manifest V3 擴充功能，協助 HaloPSA 使用者撰寫 Activity Note、整理工單、調整 Timesheet 與自訂工作介面。

## 安裝

1. 從 GitHub Releases 下載最新的 `halo-psa-extension-*.zip` 並解壓縮。
2. 開啟 Chrome 的 `chrome://extensions`。
3. 開啟右上角的「開發人員模式」。
4. 選擇「載入未封裝項目」，指定剛解壓縮的資料夾。
5. 重新整理 HaloPSA 頁面後即可使用。

> 此擴充功能只會在 HaloPSA 網域載入。AI 服務提供者與自訂設定會保存在瀏覽器本機的 extension storage。

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
