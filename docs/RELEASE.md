# 發佈指南

目前擴充功能版本為 **1.1.2**。GitHub Release 與安裝 ZIP 應對應公開來源的同一個 commit；本次品牌與文件整理不另外提升版本號。

## 發佈內容

| 項目 | 提供方式 |
| --- | --- |
| 可讀原始碼、測試與文件 | GitHub 儲存庫及對應 tag 的 Source code 下載 |
| 可直接載入的擴充功能 | `halo-psa-extension-1.1.2.zip` |
| 品牌 logo、主視覺與設計資料 | `docs/assets/`，以及 Release 的品牌資產（若提供） |
| 安裝包雜湊 | Release 的 SHA-256 校驗檔（若提供） |

## 安裝 ZIP 的精準範圍

安裝包需以 `manifest.json` 作為解壓根目錄，不額外包一層父資料夾。允許收錄的內容：

- `manifest.json`
- `src/`、`assets/`、`pet/`
- `scripts/Configure-Ornith.ps1`
- `README.md` 與 `docs/`，確保本機文件及圖像引用可讀
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

## 本次驗證

2026-09-08，Windows／Node 22.23.2：

- 完整 Node suite：**60 項測試，59 通過、0 失敗、1 略過**。唯一略過項是缺少 0.9.11 歷史來源的 prompt 逐位元比較。
- 圖片與閱讀器的 headless Chrome DOM 測試均通過；其 fixture 分別含 18 與 17 項檢查，已包含在上述 suite 的兩個測試中，沒有重複加總。
- 新增的單一主機授權、URL 拒絕與 Windows 離線設定腳本測試通過。腳本在臨時 manifest 驗證合法更新、重複設定及不合法 origin 不改檔。
- Manifest 檢查：**75 個資源引用存在**；一般 content script 的命名空間／入口順序及 MAIN bridge 群組符合檢查。

本次沒有呼叫真實 AI 或操作真實 Halo 租戶的送出／儲存流程。瀏覽器 fixtures 不代表已驗證所有租戶的原生整合。
