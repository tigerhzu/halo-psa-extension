# 開發與驗證

## 本機載入

需要 Chrome／Edge；manifest 設定最低 Chromium 122。Node 用於自動測試與本機預覽，建議使用 Node 22 或更新的相容版本。擴充功能本身沒有 npm runtime 相依或打包需求。

取得原始碼後，在瀏覽器擴充功能管理頁開啟開發人員模式，載入此專案根目錄。修改 manifest、背景服務或 content scripts 後，先重新載入擴充功能，再重新整理 Halo 頁面。

## 原始碼導覽

```text
manifest.json                 權限、頁面匹配與載入順序
src/
  core/                       編輯器介面、偵測、HTML 與圖片處理
  config/                     選擇器與功能定義
  ai/                         Provider、prompt、驗證與請求介面
  background/                 MV3 背景服務
  page/                       Halo MAIN world bridges
  features/                   撰寫、閱讀、範本、聯絡人與工時
  ui/ + styles/               工具列、主題、預覽與樣式
  ultimate-mode/              可逆簡單模式與 SPA 協調
  options/ + onboarding/      設定、備份與導覽頁
  editor-window/              獨立編輯頁
assets/ + pet/                執行時圖像與寵物資源
tests/                        Node 測試與瀏覽器 fixtures
scripts/                      Manifest 檢查、自架 AI 設定與品牌產生器
docs/                         架構、發佈與品牌文件
```

新增頁面模組時先選擇 `window.__HPX` 的責任層，再把 script 放入 manifest 中符合相依關係的位置。頁面原生元件 API 存取集中在 `src/page/`；背景 API 呼叫集中在 service worker，避免把金鑰傳入 MAIN world。

## 自動測試

```text
node scripts/verify-manifest.js
node --test tests/*.test.js
```

`verify-manifest.js` 檢查 MV3、75 個資源引用、一般 content script 的命名空間／入口順序、MAIN bridge 群組與全網址權限。新增或刪除 manifest 引用時數量會自然變動。

Node suite 使用 `node:test`、`assert` 與 VM sandbox，涵蓋 provider 路由、圖片保留、AI 輸出保護、設定匯入、編輯器偵測、簡單模式與 UI 接線。測試中的服務回覆是 stub；不會呼叫真實 AI。

圖片與閱讀器的兩個測試會尋找 Windows 已安裝的 Chrome／Edge，使用暫時 profile 啟動 headless DOM fixture；找不到瀏覽器時會略過。歷史 0.9.11 原始碼不在專案中時，只略過該版本 prompt 的逐位元比較。Ornith 設定腳本測試會在 Windows 的臨時資料夾測試 manifest 變更；非 Windows 環境會略過此項。

若當前 Windows 環境禁止背景瀏覽器啟動，可先執行以下程式測試，再用瀏覽器開啟下節對應的圖片與閱讀器 fixture；紀錄時需分開列出測試與略過項目。

```text
node --test "--test-skip-pattern=image masks preserve|ticket reader collects" tests/*.test.js
```

## 預覽與瀏覽器回歸

```text
node tests/preview-server.js
```

服務只綁定 `http://127.0.0.1:4173`。首頁是工作台示範頁，預覽 storage 與正式擴充功能分開。設定頁可用 `/src/options/options.html?preview` 開啟；停止該前景程序即可關閉預覽服務。

| 路徑 | 檢查內容 |
| --- | --- |
| `/tests/workbench-browser-test.html` | 工具列、設定、選單、鍵盤焦點與操作對比 |
| `/tests/ticket-reader-browser-test.html` | 完整活動收集、HTML 清理與閱讀控制 |
| `/tests/image-placeholder-browser-test.html` | 圖片遮罩、保護與還原 |
| `/tests/time-adjuster-browser-test.html` | 原生時間結構、唯讀秒、事件、寬窄版與停用還原 |
| `/tests/sidebar-theme-browser-test.html` | 側欄、檢視／篩選浮層、主題、選取與對比 |
| `/tests/besties-toolbar-browser-test.html` | 聯絡人快捷工具列 |

使用 browser-native、Playwright 或 DevTools 檢視頁面。專案環境禁止以 PowerShell 擷取畫面；測試與圖片產生流程不需要此做法。

實際 Halo 租戶的 DOM、編輯器套件或元件版本可能不同。修改 adapter、selector、bridge 或工時更新後，還需在已安裝擴充功能的 Halo 測試資料上，確認事件同步與保存邊界。單純 fixture 通過不代表所有租戶的實際保存流程都已通過。

## 自架 Ornith

公開預設主機為 `ornith.example.invalid`。啟用自架服務時，在已解壓或 clone 的擴充功能根目錄執行：

```powershell
.\scripts\Configure-Ornith.ps1 -Origin 'https://ai.example.com'
```

腳本只接受預設 443 埠的 HTTPS origin；允許結尾 `/`，拒絕路徑、萬用字元、帳密、query、fragment 和 IPv6 literal。它驗證目標為 Halo Companion MV3，再保留 Azure 權限、替換唯一的 Ornith 主機，最後輸出可填入設定頁的 `/v1` Base URL。可用 `-ExtensionPath` 指定另一個解壓資料夾。

1. 執行後重新載入擴充功能。
2. 設定中心選擇 Ornith，填入輸出的 Base URL、模型與 API Key。
3. 使用「測試連線」確認服務回應。此按鈕會向設定的服務送出實際請求。

背景服務同時驗證 URL 結構和 manifest 的精準 origin；只修改輸入框不足以取得新的主機權限。此設定沒有擴大全網址權限，也不會改寫既有瀏覽器 storage。更新安裝檔後若 manifest 被新版覆蓋，需要重新執行此設定。

非 Windows 環境可直接將 manifest 的 `https://ornith.example.invalid/*` 替換成自己的單一 HTTPS 主機，保留其餘權限，然後進行相同的重新載入與設定流程。請勿將本機部署地址或設定備份推送回公開儲存庫。

## 驗證紀錄

本次公開發佈整理的最終測試結果記錄於 [發佈指南](RELEASE.md)。所有測試命令均應在欲發佈的來源版本上執行；原始資料夾曾通過的結果不能取代新改動的測試。
