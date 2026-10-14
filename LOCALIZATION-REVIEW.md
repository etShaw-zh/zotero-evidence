# zh-TW 修改盤點與驗證紀錄

## 實作前盤點

基準：0.11.0，`12386229f735e5abbcbb20d44ee5307bf1de9b77`；2026-10-13 原始專案與使用者 fork 一致。

| 範圍                                                                       | 原始狀況                                           | 處理方式                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------- |
| `addon/locale/{en-US,zh-CN}/addon.ftl`                                     | 兩種語系，各 522 行                                | 新增 zh-TW，補齊共用新增鍵               |
| `src/utils/locale.ts`                                                      | Zotero 原生 Localization／Fluent                   | 保留原有語系選擇機制                     |
| `src/modules/ui/commands.ts`                                               | 大部分已國際化，類型、檔案篩選與錯誤細節仍有硬編碼 | 提取顯示文字至 Fluent                    |
| `src/modules/ui/{codingPane,ftQueuePane,taQueuePane,paneHelpers}.ts`       | 英文錯誤細節及部分類型旗標                         | 顯示時翻譯，保留服務層錯誤               |
| `addon/content/preferencesPane.xhtml`、`src/modules/ui/preferencesPane.ts` | 已有原生語系綁定                                   | 新增獨立 AI 篩選理由語言偏好             |
| `src/modules/ai/aiClient.ts`                                               | 判斷理由一律跟隨介面語言                           | 允許明確偏好；未設定時仍沿用原版         |
| `src/modules/project/collectionStructure.ts`                               | 以英文名稱識別固定分類                             | 保留持久資料識別名稱                     |
| `src/modules/db`、篩選／編碼／匯出服務                                     | 核心功能與資料結構                                 | 不修改                                   |
| `typings`                                                                  | scaffold 自動產生                                  | 透過建置更新語系及偏好型別               |
| `zotero-plugin.config.ts`                                                  | 原始專案更新來源，資產 glob 不含無副檔名 LICENSE   | 改為 fork 更新來源並明列 LICENSE／NOTICE |

## 翻譯原則

台灣用語：專案、檔案、資料庫、匯入／匯出、設定、儲存、變項、註記、信心程度、評讀者間一致性、研究資料編碼表（Codebook）。以原始英文語意校正現有中文資源，不更動 Fluent 鍵及插值參數。

已翻譯原有選單、對話框、設定、按鈕、提示、進度、篩選／編碼／證據／一致性／主題探索等訊息。另提取 Codebook 類型與旗標、檔案選擇器標籤及已知內部錯誤。外部服務與使用者資料不強制翻譯。

## 驗證結果

- 環境：macOS、Zotero 10.0.6（Gecko 140），使用獨立 `.scaffold/test/profile` 與 `.scaffold/test/data`。
- `npm ci`：成功，使用未修改的原始 package-lock.json。npm 回報 10 個既有套件弱點（1 low、3 moderate、6 high）；本次未升級依賴。
- `npm run lint:check`：通過 Prettier 與 ESLint。
- `npm run build`：完成 XPI 打包及 TypeScript 檢查。
- `node scripts/check-locales.mjs`：三種語系各 516 個訊息鍵；Fluent 語法、鍵集合、變數、屬性與授權副本核對通過。
- `npm test`：**273 項通過、0 項失敗**。包含原版 271 項功能測試及新增 2 項語系／AI 語言偏好測試。
- 前兩輪新增語系測試曾因測試沙箱入口與 Localization 建構參數不符而失敗；修正後第三輪全部通過。原版功能測試三輪均通過。
- 原始 LICENSE、package.json 的作者／授權、package-lock.json、資料庫、篩選／編碼／PDF／匯出服務皆無差異。AI 客戶端僅增加篩選理由語言偏好，不修改分析、解析或請求處理流程。
- 未執行 Zotero 7／8／9 的個別版本驗證，也未呼叫真實付費 AI API。

GitHub connector 可讀取 fork，但建立分支回傳 403 `Resource not accessible by integration`，本機 Git 推送亦因未設定 GitHub 認證而失敗。上述為初次交付時的狀態。2026-10-14 使用者完成 GitHub App 安裝後，寫入權限已恢復，已建立 `feat/zh-tw-localization` 分支供提交繁體中文與教學文件。

## 尚未涵蓋／需人工驗收

- 固定分類名稱與特殊標籤仍是英文識別值；如需全部繁中顯示，需另行設計跨語系顯示層與回退／舊版互通測試，不能直接改名。
- CSV 欄位與內建 Codebook 範例內容保留；原作者線上手冊未整站翻譯。
- 外部服務回傳錯誤、未知系統錯誤與 AI 自由文字可能仍為英文或其他語言。
- 需使用者以實際 AI 服務及研究資料完成端到端驗收；本次不呼叫付費 AI 服務。
- 尚未發布 GitHub Release／更新清單；提供測試用 XPI。
