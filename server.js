import express from 'express';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ERP_TOKEN = process.env.ERP_API_TOKEN;
const ERP_BASE  = 'https://erp2.dayungs.com/api/v1';

// ─── ERP Proxy ────────────────────────────────────────────

// GET /api/products
app.get('/api/products', async (_req, res) => {
  try {
    let all = [], page = 1;
    while (true) {
      const r = await fetch(`${ERP_BASE}/product-mappings?page=${page}&page_size=100`, {
        headers: { Authorization: `Bearer ${ERP_TOKEN}` }
      });
      const json = await r.json();
      const items = json.data ?? json.items ?? json;
      if (!Array.isArray(items) || !items.length) break;
      all = all.concat(items);
      if (items.length < 100) break;
      page++;
    }
    res.json(all);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/orders?date=YYYY-MM-DD&driver=name
app.get('/api/orders', async (req, res) => {
  try {
    const { date, driver } = req.query;
    let all = [], page = 1;
    const params = new URLSearchParams({ delivery_date: date, page_size: '100' });
    if (driver) params.set('driver_name', driver);
    while (true) {
      params.set('page', String(page));
      const r = await fetch(`${ERP_BASE}/order-details?${params}`, {
        headers: { Authorization: `Bearer ${ERP_TOKEN}` }
      });
      const json = await r.json();
      const items = json.data ?? json.items ?? json;
      if (!Array.isArray(items) || !items.length) break;
      all = all.concat(items);
      if (items.length < 100) break;
      page++;
    }
    res.json(all);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 配送紀錄 CRUD ─────────────────────────────────────────

// 把手機 items 物件轉成後台 items 陣列格式
function toAdminItems(itemsObj) {
  return Object.entries(itemsObj || {}).map(([code, it]) => {
    const retMap = {};
    (it.returnBatches || []).forEach(rb => {
      retMap[rb.expiry] = (retMap[rb.expiry] || 0) + rb.qty;
    });
    return {
      product: it.name,
      code,
      batches: (it.batches || []).map(b => ({
        expiry:   b.expiry,
        taken:    b.taken,
        returned: it.returned === null || it.returned === undefined
                    ? null
                    : (retMap[b.expiry] ?? 0),
      })),
    };
  });
}

// 把手機 rtnSelected 物件轉成後台 returnGoods 陣列格式
function toAdminReturnGoods(rtnObj) {
  return Object.entries(rtnObj || {}).map(([product, it]) => ({
    product,
    code: it.code ?? '',
    batches: (it.batches || []).map(b => ({ expiry: b.expiry, qty: b.qty })),
  }));
}

// POST /api/dispatches — 司機出門登記
app.post('/api/dispatches', async (req, res) => {
  const { driver, date, time, note, items } = req.body;
  const { data, error } = await supabase
    .from('dispatches')
    .insert({
      driver,
      date,
      departure_time: time,
      note:           note || '',
      items,            // 原始手機格式，便於 PUT 時更新
      return_goods:   {},
      status:         'out',
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/dispatches/:id — 司機回庫更新
app.patch('/api/dispatches/:id', async (req, res) => {
  const { return_time, items, return_goods, status } = req.body;
  const { data, error } = await supabase
    .from('dispatches')
    .update({
      return_time,
      items,
      return_goods,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/dispatches?date=YYYY-MM-DD[&driver=name]
// 回傳後台所需的 DATA 格式（依業務分組）
app.get('/api/dispatches', async (req, res) => {
  try {
    const { date, driver } = req.query;
    if (!date) return res.status(400).json({ error: 'date required' });

    let q = supabase.from('dispatches').select('*').eq('date', date).order('departure_time');
    if (driver) q = q.eq('driver', driver);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // 依業務分組
    const map = {};
    (data || []).forEach(row => {
      if (!map[row.driver]) {
        map[row.driver] = { driver: row.driver, date: row.date, status: 'none', dispatches: [] };
      }
      map[row.driver].dispatches.push({
        id:         row.id,
        time:       row.departure_time,
        returnTime: row.return_time ?? null,
        status:     row.status,
        note:       row.note,
        items:      toAdminItems(row.items),
        returnGoods: toAdminReturnGoods(row.return_goods),
      });
    });

    // 決定業務整體狀態
    Object.values(map).forEach(d => {
      if (!d.dispatches.length) return;
      d.status = d.dispatches.some(dp => dp.status === 'out') ? 'out' : 'done';
    });

    res.json(Object.values(map));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dispatches/raw?date=YYYY-MM-DD&driver=name
// 給手機 app 拉取當日自己的紀錄（手機原始格式）
app.get('/api/dispatches/raw', async (req, res) => {
  const { date, driver } = req.query;
  if (!date || !driver) return res.status(400).json({ error: 'date and driver required' });
  const { data, error } = await supabase
    .from('dispatches')
    .select('*')
    .eq('date', date)
    .eq('driver', driver)
    .order('departure_time');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
