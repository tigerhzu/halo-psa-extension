# Halo API 直接開案、改狀態與結案

重新載入 Chrome／Edge 擴充功能，再重新整理 Halo。點擴充功能圖示，進入 **Halo API 與案件**。

## 連線設定

1. 在 Halo 的 Configuration → Integrations → Halo API 取得 Resource Server URL（通常是 `https://company.halopsa.com/api`）。
2. 在後台填入網址與憑證。Halo Application 產生的原生 API Key 選「Halo 原生 API Key（X-Halo-Api-Key）」。Access Token 選 Bearer。公司閘道若明確要求 `X-API-Key`，選「公司閘道 API Key」，並使用提供方指定的 API 位址；不能只憑金鑰推斷網址。Client ID／Client Secret 則選 OAuth，填入 Authorisation Server URL 與 Tenant（若有）。
3. 勾選「啟用 API 直接操作」，按「儲存連線設定」，授予瀏覽器對指定主機的存取權限。
4. 按「測試連線／載入狀態」。測試只讀取狀態，不建立或修改案件；成功不代表已驗證寫入權限。
5. 要啟用結案，從清單選實際的結案狀態，填入 Halo 結案動作的 Action ID，再儲存。系統不預設任何狀態或 Action 編號。

Halo API Application／代理人的權限需要能讀取工單、讀取狀態、建立與更新工單，以及新增 Actions。租戶的工單類型、必填欄位與動作規則仍由 Halo 驗證。通知依 Halo 設定執行。

如果 API 與網頁不同站台，填寫「Halo 網頁網址」；背景服務只接受這個網頁站台的工單操作。自訂 Halo 網域的 content script 匹配範圍仍需依 README 調整 manifest。

## 使用

- **開案件**：後台下方填入標題、內容、客戶／站點／聯絡人／工單類型 ID，可選填優先級 ID，再按「建立案件」。成功後顯示實際工單 ID 與連結。若工單類型另有必填自訂欄位，請從 Halo 原生表單建立。
- **改狀態**：工單頁的「快速改狀態」會開啟 API 選單。選擇狀態後按「儲存狀態」，直接送出並讀回工單確認；不再自動跑 In Progress／Final Check 前置表單。API 直接改狀態不等同執行原生同名 Action，需跑特定動作的工作流程時請使用原生入口。
- **結案**：填寫結案說明後按「結案」，送出後台設定的 Action ID、目標狀態與說明，並讀回目標狀態。後台設定的結案狀態不可透過一般「儲存狀態」按鈕提交。
- **更新畫面**：成功後可按「重新整理 Halo 頁面」。有未完成原生動作表單時不會代為儲存或重新整理。
- **停用**：取消勾選 API 直接操作並儲存，或移除連線與金鑰，即恢復原生快速狀態流程。

## 憑證與錯誤處理

1.1.6 的 `X-API-Key` 選項沒有送出 Halo 原生要求的 `X-Halo-Api-Key`。1.1.7 新增明確的原生選項，並保留公司閘道模式。更新會沿用原有選擇；使用原生 Halo Key 時請手動改選原生選項並儲存。401 現在會顯示實際驗證方式，不再直接判定金鑰失效；若仍失敗，請核對憑證提供方的 API 位址、驗證方式及有效期限。

標頭依據：2026-10-29 查閱 [Halo 官方站台的 Application 設定程式](https://halo.haloservicedesk.com/static/ConfigPage_ApplicationList-tHCoxvHG.js)，其原生金鑰欄位直接顯示 `X-Halo-Api-Key` 範例；較新的官方版本另列 Bearer 範例，不代表所有租戶版本均支援相同方式。

憑證保存在 `chrome.storage.local.hpx_halo_api`，與 AI 設定分開。這是瀏覽器本機儲存，並非伺服器端秘密保管庫。內容腳本的 API 回覆不含金鑰，也不透過 MAIN world、DOM 事件或網址傳遞金鑰。

現有一般／完整備份僅匯出 `hpx_settings`，都不包含 Halo 連線；換電腦需重新設定。OAuth Access Token 只快取於 worker 記憶體，失效前會重新取得。金鑰與伺服器原始錯誤內容不會寫入日誌或顯示於工單頁。

寫入不自動重試。同一 worker 內，同工單寫入與建立案件各有進行中鎖，避免並行送出。逾時、斷線或送出後無法查核時會顯示結果未確認；先至 Halo 檢查再決定是否重送。這不等同伺服器端冪等保證。

改狀態前會比對選單載入時的原狀態；若他人已變更，要求重新讀取。Halo 沒有在此介面提供條件寫入，因此不能保證讀取與寫入之間完全沒有其他操作者變更。

## 開發驗證

`node --test tests/halo-api.test.js` 使用模擬 HTTP，涵蓋 POST payload、來源授權、憑證隔離、OAuth、主機權限、狀態衝突、錯誤與並行請求。

執行 `node tests/preview-server.js` 後可開啟：

- `/src/options/options.html?preview=1#halo`：後台介面與模擬開案。
- `/tests/halo-api-browser-preview.html`：API 狀態更新、結案、切換工單與未儲存表單阻擋。

這些預覽不會呼叫正式 Halo。正式租戶相容性需由使用者填入憑證後進行連線測試，並以適當測試案件驗證租戶規則。

參考：[Halo 官方 API 使用說明](https://www.usehalo.com/guides/1737)、[官方 API 文件](https://halo.haloservicedesk.com/apidoc)。
