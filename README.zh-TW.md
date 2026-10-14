# Zotero Evidence：台灣繁體中文介面

本版本以原作者 Jianjun Xiao 的 Zotero Evidence 0.11.0 為基礎，新增台灣繁體中文（zh-TW）。原始專案與 fork 的基準提交皆為 `12386229f735e5abbcbb20d44ee5307bf1de9b77`。

- 原始專案：<https://github.com/etShaw-zh/zotero-evidence>
- 本版本原始碼：<https://github.com/jackke123/zotero-evidence>
- 授權：AGPL-3.0-or-later，完整條文見 [LICENSE](LICENSE)。原作者資訊、MuPDF 授權及來源聲明均保留。

## 安裝

1. 下載此版本提供的 `.xpi` 檔案，無須解壓縮。
2. 開啟 Zotero，在「工具」選單開啟「附加元件」（部分版本稱為「外掛程式」）。
3. 點選齒輪選單，選擇「從檔案安裝附加元件…」，選取 `.xpi`，完成安裝；若 Zotero 提示，請重新啟動。
4. 在 Zotero「設定 → 進階」將語言設為「繁體中文／中文（台灣）」，依提示重新啟動。
5. 檢查「檔案」選單中的 Evidence 專案、文獻匯入、篩選標準、研究資料編碼表（Codebook）、統整分析及匯出選單。
6. 將 Zotero 語言切換為 English 並重新啟動，可恢復英文介面。沒有另設介面語言開關，使用 Zotero 原生 Fluent 語系選擇及回退機制。

本版本沿用原版外掛 ID，因此安裝後會取代同一個外掛，不會形成第二套 Evidence。升級前可先使用「封存專案」保存測試資料。初次測試建議使用獨立 Zotero 設定檔。

## 介面語言與 AI 輸出

在 Zotero 設定的 Zotero Evidence 頁面，可獨立選擇「AI 篩選理由的輸出語言」。預設「跟隨 Zotero 語言」保留原版行為；例如可同時使用繁體中文介面與英文篩選理由。

此設定只影響原版已有的 screening `reasoning` 語言指令。原文引述、證據定位、Codebook 變項名稱／編碼值不翻譯；主題探索及其他 AI 輸出沿用既有提示詞。這不是所有 AI 輸出欄位的全域翻譯開關。

## 相容性界線

- 原有 AI 分析、納入／排除判定、資料庫結構、PDF 證據定位、封存及匯出格式維持原樣。
- Codebook 類型在畫面顯示「類別／數值／文字」，實際 CSV／資料庫仍使用 `categorical`、`numeric`、`text`。
- 專案中的固定分類名稱（如 `2. TA-Screen Queue`）及特殊標籤仍保留英文，因為原版以名稱辨識資料角色。此版本不改名、不遷移既有文獻資料。
- 文獻內容、使用者筆記、AI 產生內容、外部服務原始錯誤、CSV 欄位名稱與內建 Codebook 範例資料不做自動翻譯。已知內部錯誤會在介面邊界翻譯；未識別的技術錯誤保留原文供診斷。
- 使用說明選單仍連至原作者文件；此文件補充繁體中文安裝與語系說明，並非完整原版手冊的翻譯。
- 更新來源改為此 fork，以免原始專案更新覆蓋繁體中文版本。尚未發布 fork 的更新清單前，請手動安裝後續 XPI。

## 開發與驗證

依原版 [CONTRIBUTING.md](CONTRIBUTING.md) 設定 Node.js／npm 與 Zotero 執行檔。

```sh
npm ci
npm run lint:check
npm run build
node scripts/check-locales.mjs
npm test
```

`npm test` 會使用 scaffold 的獨立測試設定檔及資料目錄。測試需可執行的 Zotero；應明確指定 `ZOTERO_PLUGIN_ZOTERO_BIN_PATH`。本次測試另將 `ZOTERO_PLUGIN_KILL_COMMAND=true`，避免測試工具的廣泛終止命令影響其他 Zotero 程序。

語系檢查會解析 Fluent，核對各語系的訊息鍵、參數及屬性，並確認安裝包的授權副本與原始 LICENSE 相同。完整測試含原版功能回歸、原生 Fluent 的 zh-TW／en-US 載入，以及獨立 AI 篩選理由語言偏好。
