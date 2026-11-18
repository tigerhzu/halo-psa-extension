# Halo 頁面效能驗證

## 1.1.11 靜閱模式 · 2026-11-18

在 Windows 使用 Chrome 157 headless，比較無擴充功能、Git tag `v1.1.10`、1.1.11 標準、1.1.11 靜閱。各組 5 次、每次新 profile、逐輪輪換測試順序。所有組別執行同一個 2,000 筆列表工作負載；擴充功能組設成相同玻璃主題、顯示桌寵、關閉簡單導覽。靜閱按設計保留原生外觀並等待手動啟用；以下瀏覽數據不含事後啟用工具的成本。

| 本機測量（中位數） | 無擴充 | 昨天 1.1.10 標準 | 1.1.11 標準 | 1.1.11 靜閱 |
| --- | ---: | ---: | ---: | ---: |
| 導覽開始到列表建完，含 fixture 載入 | 953 ms | 1,168 ms | 1,241 ms | 1,097 ms |
| 20 批工單列表渲染階段 | 645 ms | 852 ms | 867 ms | 638 ms |
| 點選列表按鈕到下一幀後的回呼（每組 25 次） | 12 ms | 54 ms | 56 ms | 12 ms |
| 瀏覽期間 JavaScript 執行時間（CDP ScriptDuration） | 3.9 ms | 69.3 ms | 69.3 ms | 7.1 ms |
| 靜置一秒：計時器／DOM 監看回呼 | 0／0 | 6／12 | 6／18 | 0／0 |

靜閱的列表渲染與點擊中位數接近原生；完整導覽仍比原生多約 144 ms。標準模式此次沒有量到整體加快。使用者點「啟用本頁工具」後，到編輯器按鈕出現並完成啟動的中位數為 **96 ms**。工具啟動後會恢復編輯器、CC 等偵測，不能把待命時的零回呼外推到使用工具期間。

測試將 manifest 內的腳本合併，和 CSS 經 localhost 載入；Halo 清單與 storage 是模擬的。每次渲染發送五次 Chromium 真實滑鼠點擊，量測事件時間戳至下一次 `requestAnimationFrame` 之後的 task，並非正式 INP。靜置前先等 1.8 秒，監測 `setTimeout`／`setInterval`、`MutationObserver` 的實際回呼，不計 fixture 自己的等待。桌寵動作有隨機性。數字代表瀏覽器工作量，不是瓦數、實體電池續航或生產租戶的載入時間；套件仍由瀏覽器載入，不是零成本。

重跑這組測試：準備 `v1.1.10` 的 checkout，再執行：

```powershell
$env:HPX_BENCH_REPEATS='5'
$env:HPX_BENCH_PET='1'
$env:HPX_BENCH_ULTIMATE='0'
node scripts/benchmark-page-load.cjs path/to/v1.1.10
```

另用 `python scripts/smoke-quiet-mode.py` 以 Playwright 載入真正的未封裝擴充功能，在攔截至本機 fixture 的 Halo 分頁驗證設定保存、鍵盤啟用、草稿、SPA 重建、重新整理、設定連結與恢復標準／簡單模式。需要 Python Playwright 與支援載入未封裝擴充的 Chromium；可用 `CHROME_PATH` 指定測試瀏覽器。

## 1.1.10 的歷史測量

2026-11-17，Windows、Node 22.23.2、Chromium headless、1280 × 900。比較的是修改前的本機 1.1.9 工作區與本次 1.1.10；前者包含當時尚未提交的外觀及 Pet 更新，並非 GitHub 上的 1.1.7。

## 量測結果

同一個模擬 Halo 頁面，每次建立 2,000 筆工單列，分 20 批、每批間隔 30ms。載入 manifest 中實際的 JavaScript 和 CSS，分別測試沒有擴充功能、修改前、修改後；一般與簡單模式各跑三次，每次使用全新的瀏覽器 profile。以下為三次中位數：

| 模式／指標 | 無擴充功能 | 修改前 1.1.9 | 優化後 1.1.10 |
| --- | ---: | ---: | ---: |
| 一般：工單列渲染階段 | 657 ms | 1,055 ms | **704 ms** |
| 一般：JavaScript CPU 時間 | 3 ms | 589 ms | **68 ms** |
| 一般：主執行緒 TaskDuration | 365 ms | 1,021 ms | **474 ms** |
| 一般：啟動版面位置讀取次數 | 0 | 38,800 | **10** |
| 簡單模式：工單列渲染階段 | 663 ms | 3,273 ms | **735 ms** |
| 簡單模式：JavaScript CPU 時間 | 3 ms | 2,925 ms | **116 ms** |
| 簡單模式：主執行緒 TaskDuration | 352 ms | 3,319 ms | **588 ms** |
| 簡單模式：啟動版面位置讀取次數 | 0 | 59,832 | **18** |

- 工單列渲染階段比修改前縮短約 **33%／78%**；在此 fixture 中，優化後與無擴充功能相差約 **7%／11%**。
- JavaScript CPU 時間降低約 **88%／96%**。靜止一秒的量測區間，沒有新增 DOM 查詢或版面量測。
- 模擬寵物樣式連續變動時，修改前額外讀取版面 10,040 次，修改後為 0 次。
- JS heap 快照一般模式約 1.94 → 1.98 MiB，簡單模式約 4.07 → 2.07 MiB。這不是完整瀏覽器記憶體或峰值量測；本次主要改善 CPU 與重複 DOM 工作，不宣稱所有模式都減少記憶體。
- 18 次執行全部完成，沒有 fixture 捕獲的未處理錯誤。

工單列時間包含固定的約 600ms 分批等待，從 runtime 載入後開始計時；**不是完整網站載入時間**。CPU 數值由 Chromium DevTools `Performance.getMetrics` 取得，涵蓋整個 fixture 導覽。版面讀取與查詢計數使用相同的 API instrumentation，比較各組的相對差異；instrumentation 本身也有開銷。

此測試使用模擬 storage/runtime、隱藏寵物及本機資產，不連線正式 Halo、不載入真實租戶資料、不執行真實 API，也不是安裝後的完整 Chrome extension 隔離環境。Halo 後端、React 工作量、網路、瀏覽器政策及使用者設定仍會影響真實速度。不能據此保證每個租戶的完整載入速度都與原生相同。

## 修改內容

- 啟動：訊息／狀態 listener 先註冊；DOM 功能逐項交給 idle callback，共用 1.5 秒 timeout 預算。忙碌頁面也不會累積成每個功能各等一秒。
- 主題：在已知原生導覽根節點內搜尋，單輪快取幾何資料；保留未知租戶結構的相容回退，過濾自身 class 標記與無關工單變動。
- 寄信視窗：一次取得 CC 欄位，移除必定無效的通用 fallback；保留寄信動作白名單、可見性、標題切換和 SPA 生命週期。
- Time Taken：索引實際標籤，只搜尋新增子樹；支援文字、aria-label、title 更新與欄位重建。
- 編輯器：子樹 existence 查詢合併成一次；內容輸入／貼上不觸發整頁工具列重新偵測。
- 簡單模式：合併渲染期間的掃描、隱藏分頁暫緩處理、Navigation API 取代固定輪詢；原生圖示列不再退回整頁文字搜尋，白名單每次搜尋只正規化一次。

## 重跑

```text
node scripts/verify-manifest.js
node --test tests/*.test.js
node scripts/benchmark-page-load.cjs
node scripts/benchmark-page-load.cjs path/to/before-workspace
```

比較前後時，第二個路徑需包含修改前的 `manifest.json` 與 `src/`；缺少的內建 `assets/`、`pet/` 由目前工作區供應。不要把私人設定或瀏覽器 profile 放入原始碼。腳本只開啟本機 fixture、啟動專用 headless Chromium，結束後刪除自己的暫存 profile，不接觸現有瀏覽器工作階段。

預設每組三次；可用環境變數 `CHROME_PATH` 指定瀏覽器、`HPX_BENCH_REPEATS` 調整次數。`HPX_BENCH_MODE=optimized`、`HPX_BENCH_ULTIMATE=1` 可指定單組，`HPX_BENCH_PROFILE=1` 另外產生 CPU profile。結果存在被 Git 忽略的 `temp/performance-results.json`，測試與 benchmark 不裝入 release ZIP。

## 在實際 Halo 比較

1. 選同一張工單或清單，維持相同瀏覽器視窗、網路與 Halo 設定。
2. 分別以停用擴充功能、舊版、新版測試；每組至少重新整理三次。切換版本後先在擴充功能管理頁重新載入。
3. 用瀏覽器 DevTools Performance 記錄從重新整理到清單／工單可操作的時間，比較主執行緒 scripting、長任務與閒置時 CPU；快取條件保持一致。
4. 確認回覆與 CC 開關、編輯器工具列、Time Taken、快速狀態、側欄面板及 SPA 換頁仍正確。正式工單的送出／儲存由使用者自行操作。

若剩餘耗時主要來自 Halo 網路請求或原生長任務，需依實機 trace 再分析。本次沒有對正式 Halo 工單執行寫入。
