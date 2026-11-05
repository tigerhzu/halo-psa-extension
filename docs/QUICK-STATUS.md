# 快速改狀態（1.1.4）

> 最新版本另提供 [Halo API 直接操作](HALO-WRITE-API.md)。啟用後台「Halo API 與案件」後，快速改狀態會直接呼叫 API；以下為 API 未啟用時保留的原生流程與歷史驗證紀錄。

## 操作方式

在 Edge 的 `edge://extensions` 重新載入 Halopsa，再重新整理 Halo。

工單上方「快速改狀態」會固定列出常用狀態、Final Check with Customer/Sales、Resolved Ticket。這版按使用者要求串接原生前置動作，不繞過 Halo 工作流程或呼叫私有 API。

- **Final Check**：入口已可用就直接開啟；否則先開 In Progress、儲存、確認新歷程與 Final Check 入口出現，再開啟 Final Check。
- **Resolved Ticket**：入口已可用就直接開啟；否則先完成必要的 In Progress 與 Final Check，各自儲存並確認後再開啟 Resolved Ticket。
- **On Hold／Pending／Postponed／Awaiting Customer Reply／Vendor Processing**：若尚無入口，先完成 In Progress，再使用原生動作。
- **最後選定的動作表單由使用者按 Save**。外掛只自動儲存必要的前置步驟；如果租戶將最終動作設為免填表 Quick Action，原生點擊本身可能立即生效。

前置動作會真正留下 Halo 歷程，工時與預設備註沿用原生值；不編造備註、不修改計時、不自動寄送 Email User 動作。

## 等待、停止與表單保護

- 只有一個連續操作可以執行；執行中按鈕停用，提供「停止接續」。
- 只辨識新動作 `.newaction` 中的 `.action-form` 與動作名稱，不點頁面上其他 Save。
- 只有確認為 In Progress／Final Check，且表單只有已辨識的工時與備註欄位時，才會自動按 Save。額外欄位、必填驗證或其他寄信控制會停下等使用者完成並手動 Save。
- 新案件可能出現 **Log Response**；外掛不替使用者決定 Yes／No，處理提示後才接續。
- 每個前置表單最多自動 Save 一次；只有新 action ID 的原生歷程名稱吻合，且下一個必要入口可用時才前進。儲存失敗不會重送；可修正原生表單後手動 Save，或停止。
- 切換工單、取消、動作表單被換成另一種 Action、已結案且沒有目標入口，會停止；每步等待上限三分鐘。
- 已儲存的前置動作不會因停止而回復；重新整理也不會自動恢復未完成的操作。
- 全部動作被收合進 More 的窄版畫面也可掛載按鈕；修正選單水平溢出，並移除與狀態無關的 delete 捷徑。

## 實機檢查與驗證範圍

2026-09-22：使用者確認 In Progress 與 Final Check 都需要表單 Save。實際租戶的 In Progress、Final Check 表單已唯讀檢查，包含 Time Taken、備註與 `.details-form-controls input[type=submit][value=Save]`；未按正式工單 Save。新案件的 Log Response 提示已確認。

本機瀏覽器 fixture 模擬原生表單、Save、非同步歷程新增與動作列重建；已驗證 Final Check、Resolved Ticket 的完整前置順序、全部動作收合至 More、Log Response 暫停與接續、Save 失敗不前進及停止功能。Node 測試涵蓋直接可用目標、前置順序、停用動作、儲存失敗不重送、既有草稿、切換工單、取消、提示與額外欄位。

完整 Node 測試：94 通過、0 失敗、1 略過（缺少歷史版本來源）；其中快速狀態相關 21 項通過。Manifest 的 78 個資源檢查通過。

正式租戶端到端自動儲存尚未執行；本機測試不等同正式工單保存驗證。

## 歷史限制

1.1.3 僅整理當前階段已有的按鈕，未實作跨階段。1.1.4 依使用者新指示改成「先完成前置步驟再開啟目標」；沒有任意更改 status_id 或改寫後台 workflow。若流程本身不存在所需路徑，會停止。
