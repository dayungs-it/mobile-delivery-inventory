# 手機版餐飲配送庫存（Mobile Delivery Inventory）

餐飲司機出門/回庫登記的手機版應用，整合 ERP 訂單與品項資料，以 Supabase 為資料庫，透過 Render.com 部署。

## 系統架構

```
┌────────────────────────────────────────┐
│        ERP 系統 (erp2.dayungs.com)     │
│      品項清單 API / 訂單明細 API       │
└────────────────┬───────────────────────┘
                 │ HTTP
┌────────────────▼───────────────────────┐
│     後端 API (Node.js + Express)       │
│          server.js                     │
│    ERP 代理 / 配送紀錄 CRUD            │
└────────┬───────────────────┬───────────┘
         │ REST API          │ Supabase SDK
┌────────▼──────┐    ┌───────▼────────────┐
│  手機版前端   │    │  Supabase (PgSQL)  │
│ public/index  │    │  配送紀錄儲存      │
│ .html         │    └────────────────────┘
└───────────────┘
┌───────────────┐
│  管理後台     │
│ public/admin  │
│ .html         │
└───────────────┘
```

## 技術棧

| 層次 | 技術 |
|------|------|
| 後端框架 | Node.js + Express 4.18.2 |
| 資料庫 | Supabase (PostgreSQL) |
| Supabase SDK | @supabase/supabase-js 2.39.0 |
| HTTP 客戶端 | axios（ERP API 呼叫） |
| CORS | cors 2.8.5 |
| 前端 | 原生 HTML5 / CSS3 / Vanilla JavaScript |
| 部署 | Render.com |

## 目錄結構

```
├── server.js                    # Express 主應用（後端）
├── package.json                 # Node.js 依賴
├── render.yaml                  # Render 部署配置
├── index.html                   # 根目錄備用頁
├── 餐飲配送庫存管理.html         # 備用完整頁
└── public/
    ├── index.html               # 手機版司機介面
    └── admin.html               # 管理後台
```

## 功能說明

### 手機版（public/index.html）— 司機介面

#### 出門登記
- 選取當日品項與數量
- 輸入效期批次資訊
- 自動帶入 ERP 訂單明細
- 提交後產生配送紀錄

#### 回庫登記
- 選取對應出門紀錄
- 登記返回品項與剩餘數量
- 記錄批次對應
- 更新配送狀態

#### 配送記錄查詢
- 查看當日所有出門/回庫紀錄
- 顯示配送狀態（途中 / 已回庫）

### 管理後台（public/admin.html）

- 配送報表：自動產生當日出門/回庫摘要
- 品項管理：ERP 品項對應維護
- 歷史查詢：依日期搜尋配送紀錄

## API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/products` | ERP 品項清單 |
| GET | `/api/orders?date=YYYY-MM-DD` | ERP 訂單明細 |
| POST | `/api/dispatches` | 登記出門 |
| PATCH | `/api/dispatches/:id` | 更新回庫 |
| GET | `/api/dispatches?date=YYYY-MM-DD` | 查詢配送紀錄 |
| GET | `/api/dispatches/raw` | 手機格式原始資料 |

### 請求範例

**登記出門**
```json
POST /api/dispatches
{
  "dispatch_date": "2024-03-15",
  "driver_emp_no": "D001",
  "driver_name": "王大明",
  "items": [
    {
      "product_code": "P001",
      "product_name": "珍珠奶茶粉",
      "qty": 10,
      "batches": [
        { "expiry_date": "2024-06-01", "qty": 10 }
      ]
    }
  ]
}
```

**更新回庫**
```json
PATCH /api/dispatches/:id
{
  "return_items": [
    {
      "product_code": "P001",
      "batches": [
        { "expiry_date": "2024-06-01", "return_qty": 3 }
      ]
    }
  ]
}
```

## Supabase 資料庫

### 資料表結構

```sql
-- 配送出門紀錄（主表）
inv_dispatches (
  id uuid PRIMARY KEY,
  dispatch_date date,
  driver_emp_no text,
  driver_name text,
  status text,          -- 'dispatched' | 'returned'
  created_at timestamptz
)

-- 配送品項明細
inv_dispatch_items (
  id uuid PRIMARY KEY,
  dispatch_id uuid REFERENCES inv_dispatches,
  product_code text,
  product_name text,
  qty integer
)

-- 效期批次
inv_dispatch_batches (
  id uuid PRIMARY KEY,
  item_id uuid REFERENCES inv_dispatch_items,
  expiry_date date,
  qty integer,
  return_qty integer DEFAULT 0
)
```

## 環境變數

```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=<anon-key>
ERP_API_BASE=https://erp2.dayungs.com
ERP_API_TOKEN=<token>
PORT=3000
```

## 部署（Render.com）

```yaml
# render.yaml
services:
  - type: web
    name: delivery-inventory-mobile
    env: node
    buildCommand: npm install
    startCommand: node server.js
    envVars:
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_ANON_KEY
        sync: false
      - key: ERP_API_TOKEN
        sync: false
```

本地開發：
```bash
npm install
# 設定 .env 環境變數
node server.js
# 開啟 http://localhost:3000/index.html （手機版）
# 開啟 http://localhost:3000/admin.html （後台）
```

## 與相關系統的關係

```
後台-餐飲配送庫存（mini-app-management）
  └── 後台管理介面（同功能的後台版本）

手機版-餐飲配送庫存（本系統）
  └── 司機手機操作介面（輕量獨立部署）
  └── 使用 Supabase 取代 SQLite（雲端資料共享）
```

**差異對比：**

| 項目 | 手機版（本系統） | 後台版 |
|------|----------------|--------|
| 資料庫 | Supabase (PgSQL) | SQLite |
| 部署 | Render + Supabase | Render Disk |
| 目標用戶 | 司機 | 管理人員 |
| 功能範圍 | 出門/回庫登記 | 完整管理 + 報表 |
