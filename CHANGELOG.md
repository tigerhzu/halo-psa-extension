# Changelog

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
