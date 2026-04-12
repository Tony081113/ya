# Pterodactyl Discord 機器人

**語言 / Language**: 繁體中文 | [English](README.md)

一個功能強大的 Discord 機器人，整合 Pterodactyl 面板，讓你直接在 Discord 中管理伺服器。基於 Discord.js v14 與 TypeScript 開發。

## 功能特色

- 🔐 **安全驗證**：將 Discord 帳號與 Pterodactyl 使用者綁定，支援 API 金鑰驗證及重複綁定防護
- 🎮 **完整伺服器管理**：建立、刪除、啟動、停止、重啟、強制關閉及監控伺服器
- 🖥️ **資源監控**：即時顯示伺服器資源使用情況（CPU、記憶體、硬碟、網路），格式智慧化
- 📊 **互動式伺服器列表**：支援分頁瀏覽及即時狀態更新
- 🎛️ **電源管理**：完整的伺服器電源控制，並驗證擁有權
- 🗄️ **SQLite 資料庫**：持久儲存使用者資料與伺服器資訊，支援外鍵約束
- 🛡️ **基於擁有權的安全機制**：伺服器操作根據實際擁有權判斷，而非 Discord 身份組
- 🎨 **現代化介面**：按鈕確認與互動選單
- 📝 **自動更新說明**：動態指令發現與分類說明系統
- ⚡ **智慧資源顯示**：記憶體/硬碟自動選擇適當單位（MiB/GiB），並顯示「無限制」

## 指令說明

### 驗證指令
- `/bind` — 將你的 Discord 帳號綁定至 Pterodactyl（自動偵測 API 金鑰，防止重複綁定）
- `/unbind` — 透過按鈕確認解除綁定
- `/status` — 查看帳號綁定狀態與可用指令

### 伺服器管理指令
- `/servers` — 以分頁方式列出所有伺服器及即時狀態
- `/create-server` — 互動式建立伺服器（選擇節點與 Egg）
- `/delete-server [server_id]` — 刪除你擁有的伺服器（基於擁有權，無需管理員身份組）
- `/power <action> <server_id>` — 管理伺服器電源（start / stop / restart / kill）
- `/monitor <server_id>` — 查看伺服器詳細資源使用量與統計

### 工具指令
- `/ping` — 查看機器人延遲、運行時間與系統資訊
- `/help [command]` — 顯示所有指令，或查詢特定指令的詳細說明

### 前綴指令
所有指令也支援 `!` 前綴（可設定）：
- `!bind <api_key>` — 簡易 API 金鑰綁定，自動偵測
- `!servers` — 以分頁方式查看你的伺服器
- `!create-server` — 互動式建立伺服器
- `!delete-server <identifier>` — 透過按鈕確認刪除伺服器
- `!power <action> <identifier>` — 伺服器電源管理
- `!monitor <identifier>` — 伺服器資源監控
- `!status` — 查看綁定狀態
- `!ping` — 機器人狀態檢查
- `!help [command]` — 指令說明

## 安裝設定

### 環境需求
- Node.js 18 以上版本
- 已部署且可存取 API 的 Pterodactyl 面板
- Discord 機器人 Token 與應用程式 ID

### 安裝步驟

1. **複製儲存庫**
   ```bash
   git clone <repository-url>
   cd pterodactyl-panel-on-discord
   ```

2. **安裝相依套件**
   ```bash
   npm install
   ```

3. **設定環境變數**
   ```bash
   cp .env.example .env
   ```

   編輯 `.env`，填入以下設定：
   ```env
   # Discord 機器人設定
   DISCORD_TOKEN=你的_discord_機器人_token
   CLIENT_ID=你的_discord_應用程式_id

   # Pterodactyl 面板設定
   PTERODACTYL_URL=https://your-panel.example.com
   PTERODACTYL_API_KEY=你的_pterodactyl_管理員_api_金鑰

   # 資料庫設定
   DATABASE_PATH=./database.sqlite

   # 機器人設定
   PREFIX=!
   ```

   > **注意**：不再需要 `ADMIN_ROLE_ID`，本機器人改用伺服器擁有權驗證，而非 Discord 身份組。

4. **建置專案**
   ```bash
   npm run build
   ```

5. **啟動機器人**
   ```bash
   npm start
   ```

## 主要功能說明

### 🔒 基於伺服器擁有權的安全機制
不同於依賴 Discord 身份組的機器人，本機器人驗證實際的 Pterodactyl 伺服器擁有權。使用者只能管理他們在面板中真正擁有的伺服器。

### 🎛️ 互動式伺服器管理
- **電源控制**：透過互動按鈕選單啟動、停止、重啟或強制關閉伺服器
- **資源監控**：查看 CPU、記憶體、硬碟用量、網路 I/O 與運行時間
- **智慧格式**：記憶體與硬碟以適當單位顯示（MiB/GiB）
- **無限制資源**：未設上限的伺服器顯示「無限制」

### 🔐 增強驗證
- **自動偵測**：API 金鑰自動識別使用者，無需手動輸入使用者 ID
- **重複防護**：防止多個 Discord 帳號綁定同一個 Pterodactyl 帳號
- **按鈕確認**：所有破壞性操作皆需透過互動按鈕確認

### 📊 進階伺服器列表
- **即時狀態**：即時更新伺服器狀態
- **分頁瀏覽**：以導覽按鈕處理大量伺服器列表
- **詳細資訊**：顯示伺服器規格、資源用量與目前狀態

### 🤖 現代化說明系統
- **自動發現**：自動偵測並分類所有可用指令
- **簡潔介面**：極簡設計，專注於重要資訊
- **動態更新**：新增指令時說明系統自動更新

## 開發

持續監聽並自動重載：
```bash
npm run dev:watch
```

單次執行開發模式：
```bash
npm run dev
```

## Discord 機器人設定

1. **建立 Discord 應用程式**
   - 前往 [Discord 開發者入口](https://discord.com/developers/applications)
   - 建立新應用程式
   - 進入「Bot」頁面並建立機器人
   - 複製機器人 Token 填入 `DISCORD_TOKEN`
   - 複製應用程式 ID 填入 `CLIENT_ID`

2. **設定機器人權限**
   - 啟用「Send Messages」、「Use Slash Commands」、「Embed Links」
   - 使用必要權限產生邀請連結

3. **邀請機器人至伺服器**
   - 使用產生的邀請連結
   - 確保機器人擁有適當的身份組權限

## Pterodactyl 面板設定

1. **產生管理員 API 金鑰**
   - 進入 Pterodactyl 面板的管理員區域
   - 前往「API → Application API」
   - 建立具有完整權限的新 API 金鑰
   - 將此金鑰填入 `PTERODACTYL_API_KEY`

2. **使用者 API 金鑰**
   - 使用者需自行產生客戶端 API 金鑰
   - 前往「Account → API Credentials → Create API Key」
   - 使用者將以這些金鑰執行 `/bind` 指令

## 資料庫結構

本機器人使用 SQLite，包含以下資料表：

### bound_users（已綁定使用者）
- `id` — 主鍵
- `discord_id` — Discord 使用者 ID（唯一）
- `pterodactyl_user_id` — Pterodactyl 使用者 ID（唯一，防止重複綁定）
- `pterodactyl_api_key` — 使用者的 Pterodactyl API 金鑰
- `bound_at` — 綁定時間戳記

### user_servers（使用者伺服器）
- `id` — 主鍵
- `discord_id` — Discord 使用者 ID（外鍵）
- `server_uuid` — Pterodactyl 伺服器 UUID
- `server_name` — 伺服器名稱
- `created_at` — 建立時間戳記

**外鍵約束**：確保資料完整性，並在使用者解除綁定時自動清理相關資料。

## 安全特性

- **伺服器擁有權驗證**：所有伺服器操作均驗證實際的 Pterodactyl 擁有權，而非 Discord 身份組
- **API 金鑰自動偵測**：自動從 API 金鑰識別使用者，無需手動輸入使用者 ID
- **重複防護**：一個 Pterodactyl 帳號只能綁定一個 Discord 帳號
- **輸入驗證**：所有使用者輸入均經過驗證與清理
- **按鈕確認**：破壞性操作需要互動按鈕確認
- **私密回應**：敏感資訊使用 Discord 的 ephemeral 訊息
- **錯誤處理**：完整的錯誤處理機制，防止資訊外洩
- **資源存取控制**：使用者只能管理其實際擁有的伺服器

## 錯誤處理

本機器人針對以下情況提供完整的錯誤處理：
- 無效的 API 金鑰（含具體錯誤訊息）
- 網路連線問題與逾時
- Pterodactyl API 錯誤（轉換為使用者易懂的訊息）
- 資料庫連線問題與約束違反
- Discord API 速率限制與互動逾時
- 伺服器擁有權驗證失敗
- 資源監控 API 錯誤
- 電源狀態切換失敗

## 貢獻指南

1. Fork 此儲存庫
2. 建立功能分支
3. 進行修改
4. 徹底測試
5. 提交 Pull Request

## 授權條款

本專案採用 MIT 授權條款。

## 支援

如需協助，請：
1. 查閱日誌中的錯誤訊息
2. 確認 `.env` 中的設定正確
3. 確保 Pterodactyl 面板可正常存取
4. 檢查 Discord 機器人權限

## 疑難排解

### 常見問題與解決方法

#### 「您沒有刪除此伺服器的權限」
- **原因**：你正嘗試刪除一個你在 Pterodactyl 中不擁有的伺服器
- **解決方法**：只有伺服器擁有者才能刪除伺服器，Discord 管理員身份組不會覆蓋此限制

#### 伺服器指令出現「找不到伺服器」
- **原因**：伺服器識別碼不符，或你沒有存取權限
- **解決方法**：使用 `/servers` 查看你的可用伺服器，並複製正確的名稱或 UUID

#### 綁定問題
若在嘗試綁定時出現「無效 API 金鑰」錯誤：

1. **確認 API 金鑰類型**：請確認你使用的是**客戶端 API 金鑰**，而非應用程式 API 金鑰
   - 前往 Pterodactyl 面板 → 帳號設定 → API Credentials
   - 建立新的客戶端 API 金鑰（開頭為 `ptlc_`）

2. **確認面板網址**：確保 `.env` 中的 `PTERODACTYL_URL` 正確：
   - 結尾**不應**有 `/api/`
   - 範例：`https://panel.example.com`（而非 `https://panel.example.com/api/`）

3. **測試面板存取**：直接嘗試存取你的面板，確認可正常連線

#### 電源指令問題
- **「伺服器已處於該狀態」**：伺服器已在請求的電源狀態中
- **「電源操作失敗」**：檢查伺服器是否支援該操作（部分 Egg 不支援所有電源狀態）

#### 資源監控問題
- **「無法取得資源使用量」**：伺服器可能離線，或面板 API 暫時不可用
- **「資源資料不可用」**：部分伺服器在離線時不會回報資源使用量

### 錯誤訊息說明

- **「Connection refused（連線被拒）」**：面板網址錯誤或面板已關閉
- **「Domain not found（找不到網域）」**：面板網址的網域不存在
- **「Access forbidden（存取被拒）」**：API 金鑰權限問題
- **「Endpoint not found（找不到端點）」**：面板網址路徑錯誤
- **「Account already bound（帳號已綁定）」**：每個 Discord 使用者只能綁定一個 Pterodactyl 帳號

### 除錯模式

在 `.env` 中設定 `NODE_ENV=development` 可啟用除錯日誌。

## 效能與可靠性

- **高效資料庫**：SQLite 搭配適當索引與外鍵約束
- **錯誤恢復**：妥善處理網路問題與 API 逾時
- **記憶體管理**：適當的清理與資源管理
- **速率限制**：遵守 Discord 與 Pterodactyl API 速率限制
- **連線池**：最佳化的資料庫連線
- **背景處理**：非阻塞操作提升回應能力

## 更新日誌

### v2.0.0（目前版本）
- ✅ **修正伺服器擁有權驗證** — 移除 Discord 身份組要求，改用實際 Pterodactyl 擁有權
- ✅ **新增完整電源管理** — 透過互動選單啟動、停止、重啟、強制關閉伺服器
- ✅ **實作資源監控** — 即時伺服器資源使用量，智慧格式顯示
- ✅ **增強伺服器列表** — 分頁瀏覽、即時狀態更新與智慧資源顯示
- ✅ **新增重複防護** — 每個 Pterodactyl 帳號只能綁定一個 Discord 使用者
- ✅ **改善按鈕確認** — 破壞性操作採用互動按鈕確認
- ✅ **自動更新說明系統** — 動態指令發現與分類說明
- ✅ **智慧資源格式** — MiB/GiB 顯示與無上限資源的「無限制」標示
- ✅ **修正指令載入錯誤** — 解決生產環境中 .d.ts 檔案載入問題
- ✅ **簡潔說明介面** — 移除說明指令中的雜訊，提升使用者體驗

### v1.0.0
- 初始版本
- 基本伺服器管理指令
- 使用者驗證系統
- 管理員身份組支援
- SQLite 資料庫整合
