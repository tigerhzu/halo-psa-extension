# 發佈指南

目前公開發佈版本為 **1.1.12**。執行 `python scripts/build-release.py`，產生安裝 ZIP 與 SHA-256 校驗檔。正式 GitHub 發佈使用對應的乾淨 Git commit；本機分享包若包含未提交修改，會在 `release-info.json` 標記 `sourceIncludesWorkingTreeChanges`。

## 發佈內容

| 項目 | 提供方式 |
| --- | --- |
| 可讀原始碼、測試與文件 | GitHub 儲存庫及對應 tag 的 Source code 下載 |
| 可直接載入的擴充功能 | `halo-psa-extension-1.1.12.zip` |
| 品牌 logo、主視覺與設計資料 | `docs/assets/`，以及 Release 的品牌資產（若提供） |
| 安裝包雜湊 | Release 的 SHA-256 校驗檔（若提供） |

## 安裝 ZIP 的精準範圍

安裝包需以 `manifest.json` 作為解壓根目錄，不額外包一層父資料夾。允許收錄的內容：

- `manifest.json`
- `src/`、`assets/`、`pet/`
- `scripts/Configure-Ornith.ps1`
- 安裝說明、版本資訊、更新摘要、`docs/HALO-WRITE-API.md` 與 `docs/PERFORMANCE.md`
- 儲存庫既有的授權／第三方聲明檔（若存在）

不收錄 `.git/`、`output/`、舊版 `release/`、`tests/`、個人設定匯出、瀏覽器 profile、benchmark 結果或執行紀錄。測試原始碼可以公開在儲存庫，測試程式與示範資料不必裝進瀏覽器。

先在乾淨的待發佈資料夾依上述範圍組裝，再封裝。不要直接壓縮整個開發工作目錄，避免遞迴加入歷史 ZIP 或本機資料。

## 發佈前驗證

```text
node scripts/verify-manifest.js
node --test tests/*.test.js
```

1. 確認 manifest 版本與 ZIP 名稱一致，且所有引用檔案存在。
2. 確認公開 manifest 中自架 AI 仍使用示例主機，source 不含部署專用主機、真實 API Key、設定備份或客戶資料。
3. 執行對應變更的瀏覽器 fixtures；若修改原生橋接，另外驗證實際 Halo 測試資料上的寫回行為。
4. 在臨時資料夾解壓安裝包，檢查根目錄結構及 manifest 引用。圖片與文件應與來源一致。
5. 為最終 ZIP 計算 SHA-256，再將來源 commit、版本、變更摘要與校驗檔一併放入 Release。

本機執行 `Configure-Ornith.ps1` 後的 manifest 包含部署專用主機，屬於使用者的安裝設定；公開發佈仍應從示例主機版本重新組裝。

## 1.1.12 公開版驗證

2026-11-27：完整 Node suite **182 項，181 通過、0 失敗、1 略過**（缺少 0.9.11 歷史來源）。Manifest 的 83 個引用通過驗證，所有 JavaScript 通過 `node --check`、JSON 均可解析。本版僅驗證本機自動測試；靜閱即時切換與移除 Pet 頁面尚未在正式 Halo 租戶上實測。

## 1.1.10 公開版驗證

2026-11-17：完整 Node suite **189 項，188 通過、0 失敗、1 略過**（缺少 0.9.11 歷史來源）。包含 Chromium 真實 DOM 的主題、CC、Time Taken 回歸；Time Taken wrapper 內含 554 項既有操作／版面檢查與 17 項增量偵測檢查，不重複加總為 Node 測試數量。Manifest 的 83 個引用通過驗證。

無擴充功能／修改前／修改後的三組比較，於一般及簡單模式各跑三次，共 18 次，沒有未處理錯誤。量測結果、條件與實機限制見 [效能驗證](PERFORMANCE.md)。安裝 ZIP 從已提交且使用示例主機的乾淨來源建立，附 SHA-256 與來源 commit；本機部署主機仍保留在使用者工作區。

## 1.1.9 本機分享包驗證

2026-11-13：完整 Node suite 共 169 項，168 通過、0 失敗、1 略過（缺少 0.9.11 歷史來源）。涵蓋新安裝預設、各版本備份匯入時重設五項外觀值、Pet 資料夾匯入與備份還原。Manifest 的 83 個資源引用通過驗證。

新安裝與設定檔匯入統一採用：輕透、#FF7A1A、海洋、強度 42%、透明度 45%（opacity 為 55）。本機瀏覽器預覽已實測整個 Claude Crab 資料夾匯入成功；設定檔匯入的配色政策由 production import path 的自動測試驗證。本次為含工作區修改的本機 ZIP，尚未發佈至 GitHub Release。

## 1.1.8 本機分享包驗證

2026-11-13：完整 Node suite 共 150 項，149 通過、0 失敗、1 略過（缺少 0.9.11 歷史來源）。包含新安裝外觀預設與既有設定保留、首次繪製與主題預設一致性檢查。Manifest 的 83 個資源引用通過驗證。

新安裝預設為輕透、#FF7A1A、海洋背景、渲染強度 42%、透明度 45%（儲存值 opacity 為 55）。本次是含工作區修改的本機 ZIP，尚未發佈至 GitHub Release；正式 Halo 儲存與 AI 服務連線未重新實測。

## 1.1.2 歷史驗證

2026-09-08，Windows／Node 22.23.2：

- 完整 Node suite：**60 項測試，59 通過、0 失敗、1 略過**。唯一略過項是缺少 0.9.11 歷史來源的 prompt 逐位元比較。
- 圖片與閱讀器的 headless Chrome DOM 測試均通過；其 fixture 分別含 18 與 17 項檢查，已包含在上述 suite 的兩個測試中，沒有重複加總。
- 新增的單一主機授權、URL 拒絕與 Windows 離線設定腳本測試通過。腳本在臨時 manifest 驗證合法更新、重複設定及不合法 origin 不改檔。
- Manifest 檢查：**75 個資源引用存在**；一般 content script 的命名空間／入口順序及 MAIN bridge 群組符合檢查。

本次沒有呼叫真實 AI 或操作真實 Halo 租戶的送出／儲存流程。瀏覽器 fixtures 不代表已驗證所有租戶的原生整合。
