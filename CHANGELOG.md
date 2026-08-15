# Changelog

## Unreleased

- 新增完整設定檔備份：可一鍵匯出含 API Key、匯出不含 API Key，或匯入完整設定；不含 API Key 的設定檔匯入時會保留本機金鑰。
- Cute／果凍模式首次使用的預設 Accent 改為純黑 `#000000`。
- Quick Links 卡片移除前置箭頭圖示，並保留乾淨的拖曳排序介面。

## v0.9.3 — 2026-08-15

- 修正設定頁 Team 清單未同步到 Timesheets 前台快捷列的問題；快捷列現在會即時跟隨保留 Team 的新增、刪除與排序，非 A/B/C Team 使用文字徽章顯示。
- 新增獨立分頁三步驟「首次登入提示」：Team、AI API 與永遠 CC 都可設定或略過；內嵌回退時會先卸載摯友工具列。
- 極致模式 Team 白名單改為可自訂，支援 Project Manager、RD、Thailand Team、Sales&Admin 與任意 HaloPSA Team 名稱。
- 新增永遠 CC 收件人；HaloPSA 寄信視窗開啟時自動加入，並沿用既有去重與原生欄位寫入流程。
- 設定頁可管理保留 Team、永遠 CC、自訂 cc 收件人，並可從獨立頁面重新開啟「首次登入提示」。
- Op Team A、B、C 改為獨立選項，選擇單一 Team 時不再連帶顯示另外兩組。
- 進入 Op Team A／B／C 時，作用中的 Team 會自動展開，保留 Halo 原生收合控制。
- 修正 Cute 模式下自訂 cc 下拉名單被編輯器工具列蓋住的圖層問題。
- New Ticket 不再顯示 Extension 自己的編輯工具列，一般 Ticket／Activity Note 工具列維持不變。
- 簡單模式新增頁首右上角原生工具按鈕的 fail-safe 隱藏與 SPA 導覽同步；關閉模式可完整恢復。
- Ticket 詳情頁右上角上一筆／開新視窗／分享／列印等 utility actions 改為獨立可逆隱藏，不影響主要 Ticket status actions。
- Cute／Default 外觀的 Accent Color 新增原生調色盤，可輸入自訂色碼並保存到本機設定。
- 浮動設定面板移除 Save Settings；主題、Accent、寵物與 Quick Link 完成變更後立即套用並保存。
- 浮動面板的完整設定入口改名為「設定」，點擊面板外側會自動關閉面板。
- 修正簡單模式切換為 OFF 時因殘留狀態文字參照造成恢復流程未執行的問題。
- New Ticket 頁面不再掛載摯友名單工具列，也不會套用寄信視窗的預設 CC。
- 首次登入預設外觀固定為 Cute＋`#000000` Accent，簡單模式預設關閉；修正 Cute 下左上角 Search Tickets placeholder 對比不足。
- 補齊簡單模式的 Team catalog：Other Support、SecOp Team A、Technical Solutions Division；舊版已保存的 Team 清單會一次遷移補齊，之後仍可自行移除。
- 新增左下角固定控制列，集中提供 mode、color、pet 與 settings 操作。
- Quick Links 改為可新增、編輯、刪除與上下拖曳排序的卡片介面，移除前方箭頭與多餘說明文字，並在編輯時自動保持於視窗內。
- PET 選擇改為立即套用、保存並關閉選單；Quick Links 面板會依 PET 位置自動選擇左右側並夾在視窗範圍內。
- 修正 Cute 模式開啟獨立 Note 編輯頁時誤顯示預設 AI 按鈕的問題。
- 主題名稱改為「果凍」與「預設」，並保留即時套用與保存。
- 完全移除「整理格式」功能及相關工具列、編輯器與預覽入口。
- 簡單模式的使用者 Team 選擇會跨 Tickets、Timesheets 與其他 Team 導覽保留。

## v0.9.2 — 2026-08-14

- 修正極致模式下的 More 選單：`Final Check with Customer/Sales` 可穩定保留並使用 HaloPSA 原生流程。
- Final Check 後，保留重新渲染出的 `Resolve Ticket`／`Resolved Ticket` 動作。
- README 補充 Future 模式（極致模式／Ultimate Mode）完整介紹、可保留的操作與還原方式。

## v0.9.1 — 2026-08-13

- 新增 Ultimate Mode：可在設定頁與浮動設定面板即時開關，僅隱藏 HaloPSA 原生 UI，關閉時完整還原。
- 極致模式保留 Op Team A / B / C 與 Timesheets，支援 SPA 切頁、原生 Team 點擊與 Timesheets 返回捷徑。
- 極致模式精簡 Ticket 動作、Ticket Information 與 End-User Details，同時保留既有 Extension 功能。
- 修正 Cute 模式在白底 Team 選擇器與 New Ticket 表單上的低對比文字。
- 新增 Team A / B / C 與 Timesheets 的星河 Sidebar 圖示資產。

## v0.9.0 — 2026-08-11

- 移除 Timesheet 自動時間對齊，改為可靠的手動調整流程；重疊時段不再阻擋調整。
- 修正 Timesheet 調整成功但重新開啟後未保存的寫回問題。
- 新增 Claude Crab 預設寵物，以及 `pet/` 自訂寵物資料夾支援。
- 新增設定面板的自訂 URL 捷徑按鈕。
- 修正 Cute 主題下快速範本按鈕無法點選的問題。
- Activity Note 編輯器新增圖片拖曳縮放與寬度調整。
- 客戶版 AI 改為固定問候、正文、致謝格式，且不會猜測客戶姓名。
- 工單版 AI 改為固定條列，使用稀疏的語意標籤上色。
- 強化 HaloPSA 富文字編輯器的框架寫回流程。
- 發佈 ZIP 現在包含 `pet/` 自訂寵物，並驗證 manifest 的萬用字元資源。

## v0.8.0 — 2026-08-10

- 首次公開發佈的 HaloPSA Writing Helper 版本。
