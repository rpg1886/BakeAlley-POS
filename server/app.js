const express = require('express');
const crypto = require('node:crypto');
const { pool, migrate } = require('./db');
const { createAuthRouter } = require('./auth');

const app = express();
app.use(express.json({ limit: '5mb' }));
const auth = createAuthRouter(express, pool);
app.use('/api/v1', auth.router);

app.get('/api/v1/health', async (_request, response, next) => {
  try { await pool.query('SELECT 1'); response.json({ ok: true }); } catch (error) { next(error); }
});
app.get('/api/v1/version', (_request, response) => response.json({ version: process.env.APP_VERSION ?? '0.1.0-cloud' }));

app.get('/api/v1/products/search', auth.requireSession, async (request, response, next) => {
  try {
    const query = `%${String(request.query.q ?? '').trim()}%`;
    const result = await pool.query(`SELECT v.variant_id AS "variantId", v.sku, v.variant_name AS name, u.symbol AS unit, p.is_sold_by_weight AS "soldByWeight", pp.tier_id AS "tierId", pp.min_quantity AS "minQuantity", pp.price_per_unit AS "pricePerUnit" FROM product_variants v JOIN products p ON p.product_id=v.product_id JOIN units_of_measure u ON u.uom_id=p.base_uom_id LEFT JOIN product_prices pp ON pp.variant_id=v.variant_id WHERE v.sku ILIKE $1 OR v.barcode ILIKE $1 OR v.variant_name ILIKE $1 OR p.name ILIKE $1 ORDER BY v.variant_name LIMIT 40`, [query]);
    const grouped = new Map();
    for (const row of result.rows) { if (!grouped.has(row.variantId)) grouped.set(row.variantId, { variantId: row.variantId, sku: row.sku, name: row.name, unit: row.unit, soldByWeight: row.soldByWeight, prices: [] }); if (row.tierId) grouped.get(row.variantId).prices.push({ tierId: row.tierId, minQuantity: Number(row.minQuantity), pricePerUnit: Number(row.pricePerUnit) }); }
    response.json([...grouped.values()]);
  } catch (error) { next(error); }
});

app.get('/api/v1/customers', auth.requireSession, async (_request, response, next) => {
  try { const result = await pool.query('SELECT customer_id AS "customerId", COALESCE(company_name || \' - \', \'\') || contact_name AS "displayName", email, phone, tier_id AS "tierId" FROM customers ORDER BY contact_name'); response.json(result.rows); } catch (error) { next(error); }
});

app.post('/api/v1/customers', auth.requireSession, async (request, response, next) => {
  try {
    const body = request.body ?? {};
    if (!body.contactName || !body.tierId) return response.status(400).json({ error: 'INVALID_CUSTOMER' });
    const result = await pool.query(`INSERT INTO customers (customer_id, company_name, contact_name, email, phone, tier_id)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
      RETURNING customer_id AS "customerId", COALESCE(company_name || ' - ', '') || contact_name AS "displayName", email, phone, tier_id AS "tierId"`, [body.companyName ?? null, body.contactName, body.email ?? null, body.phone ?? null, body.tierId]);
    response.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.delete('/api/v1/customers/:id', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  try {
    const protectedCustomer = await pool.query('SELECT 1 FROM orders WHERE customer_id = $1 LIMIT 1', [request.params.id]);
    if (protectedCustomer.rowCount) return response.status(409).json({ error: 'CUSTOMER_HAS_ORDERS' });
    const result = await pool.query('DELETE FROM customers WHERE customer_id = $1', [request.params.id]);
    if (!result.rowCount) return response.status(404).json({ error: 'CUSTOMER_NOT_FOUND' });
    response.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/v1/inventory', auth.requireSession, async (_request, response, next) => {
  try { const result = await pool.query(`SELECT v.variant_id AS "variantId", v.sku, v.variant_name AS "variantName", COALESCE(SUM(l.quantity_on_hand), 0) AS "quantityOnHand", MIN(l.expiration_date) AS "expirationDate", COALESCE(p.initial_cost, 0) AS "initialCapital", COALESCE((SELECT pp.price_per_unit FROM product_prices pp JOIN price_tiers pt ON pt.tier_id=pp.tier_id WHERE pp.variant_id=v.variant_id AND lower(pt.tier_name)='retail' ORDER BY pp.min_quantity LIMIT 1), 0) AS "retailPrice" FROM product_variants v JOIN products p ON p.product_id=v.product_id LEFT JOIN inventory_lots l ON l.variant_id=v.variant_id GROUP BY v.variant_id, v.sku, v.variant_name, p.initial_cost ORDER BY v.variant_name`); response.json(result.rows.map((row) => ({ ...row, quantityOnHand: Number(row.quantityOnHand) || 0, initialCapital: Number(row.initialCapital) || 0, retailPrice: Number(row.retailPrice) || 0 }))); } catch (error) { next(error); }
});

app.post('/api/v1/inventory/adjust', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  const body = request.body ?? {};
  const quantity = Number(body.quantity);
  const price = body.retailPrice === undefined || body.retailPrice === '' ? undefined : Number(body.retailPrice);
  if (!body.variantId || !Number.isFinite(quantity) || quantity < 0 || (price !== undefined && (!Number.isFinite(price) || price < 0))) return response.status(400).json({ error: 'INVALID_INVENTORY_ADJUSTMENT' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const variant = await client.query('SELECT variant_id FROM product_variants WHERE variant_id=$1 FOR UPDATE', [body.variantId]);
    if (!variant.rowCount) throw Object.assign(new Error('Variant not found'), { statusCode: 404, code: 'VARIANT_NOT_FOUND' });
    const lotNumber = body.lotNumber || `CLOUD-${body.variantId.slice(0, 8)}-${body.expirationDate || 'NOEXPIRY'}`;
    await client.query(`INSERT INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand) VALUES (gen_random_uuid(), $1, $2, $3, $4)
      ON CONFLICT (variant_id, lot_number) DO UPDATE SET expiration_date=EXCLUDED.expiration_date, quantity_on_hand=EXCLUDED.quantity_on_hand, updated_at=now()`, [body.variantId, lotNumber, body.expirationDate || null, quantity]);
    if (price !== undefined) {
      const retailTier = await client.query("SELECT tier_id FROM price_tiers WHERE lower(tier_name)='retail' LIMIT 1");
      if (!retailTier.rowCount) throw Object.assign(new Error('Retail tier is not configured'), { statusCode: 409, code: 'RETAIL_TIER_NOT_FOUND' });
      await client.query(`INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity) VALUES (gen_random_uuid(), $1, $2, $3, 0)
        ON CONFLICT (variant_id, tier_id, min_quantity) DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit`, [body.variantId, retailTier.rows[0].tier_id, price]);
    }
    await client.query('COMMIT');
    response.status(200).json({ updated: true });
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); } finally { client.release(); }
});

app.post('/api/v1/inventory/products', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  const body = request.body ?? {};
  const quantity = Number(body.quantity);
  const price = Number(body.retailPrice);
  if (!body.name || !body.sku || !body.variantName || !body.lotNumber || !body.baseUomId || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(price) || price < 0) return response.status(400).json({ error: 'INVALID_PRODUCT_INVENTORY' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const retailTier = await client.query("SELECT tier_id FROM price_tiers WHERE lower(tier_name)='retail' LIMIT 1");
    if (!retailTier.rowCount) throw Object.assign(new Error('Retail tier is not configured'), { statusCode: 409, code: 'RETAIL_TIER_NOT_FOUND' });
    const product = await client.query(`INSERT INTO products (product_id, name, base_uom_id, is_sold_by_weight, requires_lot_tracking, initial_cost) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING product_id`, [body.name, body.baseUomId, Boolean(body.soldByWeight), Boolean(body.requiresLotTracking), Number(body.initialCost) || 0]);
    const variant = await client.query(`INSERT INTO product_variants (variant_id, product_id, sku, barcode, variant_name) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING variant_id AS "variantId", sku, variant_name AS "variantName"`, [product.rows[0].product_id, body.sku, body.barcode || null, body.variantName]);
    await client.query('INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity) VALUES (gen_random_uuid(), $1, $2, $3, 0)', [variant.rows[0].variantId, retailTier.rows[0].tier_id, price]);
    await client.query('INSERT INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand) VALUES (gen_random_uuid(), $1, $2, $3, $4)', [variant.rows[0].variantId, body.lotNumber, body.expirationDate || null, quantity]);
    await client.query('COMMIT');
    response.status(201).json(variant.rows[0]);
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); } finally { client.release(); }
});

app.get('/api/v1/employees', auth.requireSession, async (request, response, next) => {
  try {
    const result = await pool.query(`SELECT u.user_id AS "userId", u.username, u.display_name AS "displayName", u.role, u.active,
      COUNT(o.order_id)::int AS "salesCount", COALESCE(SUM(o.total_amount), 0) AS "salesAmount"
      FROM app_users u LEFT JOIN orders o ON o.employee_id = u.user_id AND o.status = 'completed'
      WHERE ($1 = 'admin' OR u.user_id = $2) GROUP BY u.user_id ORDER BY u.display_name`, [request.user.role, request.user.userId]);
    response.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/v1/employees', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  try {
    const body = request.body ?? {};
    if (!body.username || !body.displayName || !body.password || !['admin', 'cashier'].includes(body.role)) return response.status(400).json({ error: 'INVALID_EMPLOYEE' });
    if (String(body.password).length < 12) return response.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(body.password), salt, 64).toString('hex');
    const result = await pool.query(`INSERT INTO app_users (user_id, username, display_name, role, password_salt, password_hash)
      VALUES (gen_random_uuid(), lower($1), $2, $3, $4, $5)
      RETURNING user_id AS "userId", username, display_name AS "displayName", role, active`, [body.username, body.displayName, body.role, salt, hash]);
    response.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.post('/api/v1/employees/clock-in', auth.requireSession, async (request, response, next) => {
  try {
    await autoCloseOvernightShifts();
    const openingFloat = Number(request.body?.openingFloat) || 1500.00;
    const notes = request.body?.notes || null;

    const existing = await pool.query(
      "SELECT shift_id, status FROM employee_shifts WHERE user_id = $1 AND (clock_out IS NULL OR status = 'PENDING_PHYSICAL_COUNT')",
      [request.user.userId]
    );

    if (existing.rowCount > 0) {
      const status = existing.rows[0].status;
      if (status === 'PENDING_PHYSICAL_COUNT') {
        return response.status(409).json({ error: 'PENDING_SHIFT_COUNT_REQUIRED', message: "You have a pending cash count for yesterday's shift." });
      }
      return response.status(409).json({ error: 'SHIFT_ALREADY_OPEN' });
    }

    const result = await pool.query(
      'INSERT INTO employee_shifts (shift_id, user_id, clock_in, opening_float, status, notes) VALUES (gen_random_uuid(), $1, now(), $2, \'OPEN\', $3) RETURNING shift_id AS "shiftId", user_id AS "userId", clock_in AS "clockIn", COALESCE(opening_float, 1500.00)::numeric AS "openingFloat", status',
      [request.user.userId, openingFloat, notes]
    );

    response.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.post('/api/v1/employees/clock-out', auth.requireSession, async (request, response, next) => {
  try {
    await autoCloseOvernightShifts();
    const closingCashCount = Number(request.body?.closingCashCount) || 0;
    const notes = request.body?.notes || null;

    const shiftRes = await pool.query(
      "SELECT shift_id, clock_in, clock_out, status, COALESCE(opening_float, 1500.00)::numeric AS \"openingFloat\" FROM employee_shifts WHERE user_id = $1 AND (clock_out IS NULL OR status = 'PENDING_PHYSICAL_COUNT' OR status = 'OPEN') ORDER BY clock_in DESC LIMIT 1",
      [request.user.userId]
    );

    if (!shiftRes.rowCount) {
      return response.status(409).json({ error: 'NO_OPEN_SHIFT' });
    }

    const { shift_id, clock_in, clock_out: existingClockOut, status, openingFloat } = shiftRes.rows[0];

    const salesRes = await pool.query(
      "SELECT COALESCE(SUM(total_amount), 0)::numeric AS \"shiftCashSales\" FROM orders WHERE employee_id = $1 AND status = 'completed' AND payment_method ILIKE '%cash%' AND created_at >= $2::timestamptz" + (existingClockOut ? " AND created_at <= $3::timestamptz" : ""),
      existingClockOut ? [request.user.userId, clock_in, existingClockOut] : [request.user.userId, clock_in]
    );

    const shiftCashSales = Number(salesRes.rows[0].shiftCashSales) || 0;
    const expectedCash = Number(openingFloat) + shiftCashSales;
    const cashDiscrepancy = closingCashCount - expectedCash;
    const newStatus = status === 'PENDING_PHYSICAL_COUNT' ? 'CLOSED_NEXT_DAY' : 'CLOSED';

    const updateRes = await pool.query(
      'UPDATE employee_shifts SET clock_out = COALESCE(clock_out, now()), closing_cash_count = $1, expected_cash = $2, cash_discrepancy = $3, status = $4, notes = COALESCE($5, notes) WHERE shift_id = $6 RETURNING shift_id AS "shiftId", user_id AS "userId", clock_in AS "clockIn", clock_out AS "clockOut", COALESCE(opening_float, 1500.00)::numeric AS "openingFloat", closing_cash_count AS "closingCashCount", expected_cash AS "expectedCash", cash_discrepancy AS "cashDiscrepancy", status, notes',
      [closingCashCount, expectedCash, cashDiscrepancy, newStatus, notes, shift_id]
    );

    response.json(updateRes.rows[0]);
  } catch (error) { next(error); }
});

app.get('/api/v1/employees/shifts', auth.requireSession, async (request, response, next) => {
  try {
    await autoCloseOvernightShifts();
    const date = String(request.query.date ?? '').trim();
    const isDateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
    
    let dateFilter = '';
    const params = [request.user.role, request.user.userId];

    if (isDateValid) {
      params.push(date);
      dateFilter = "AND (s.clock_out IS NULL OR s.status = 'PENDING_PHYSICAL_COUNT' OR s.status = 'OPEN' OR (s.clock_in >= $3::date AT TIME ZONE 'Asia/Manila' AND s.clock_in < ($3::date + interval '1 day') AT TIME ZONE 'Asia/Manila'))";
    }

    const result = await pool.query(
      `SELECT s.shift_id AS "shiftId", s.user_id AS "userId", u.display_name AS "displayName", u.role AS "role",
              s.clock_in AS "clockIn", s.clock_out AS "clockOut",
              COALESCE(s.opening_float, 1500.00)::numeric AS "openingFloat",
              s.closing_cash_count AS "closingCashCount",
              s.expected_cash AS "expectedCash",
              s.cash_discrepancy AS "cashDiscrepancy",
              COALESCE(s.status, CASE WHEN s.clock_out IS NULL THEN 'OPEN' ELSE 'CLOSED' END) AS status,
              s.notes
       FROM employee_shifts s
       JOIN app_users u ON u.user_id=s.user_id
       WHERE ($1 = 'admin' OR s.user_id = $2) ${dateFilter}
       ORDER BY s.clock_in DESC LIMIT 100`,
      params
    );

    response.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/v1/orders', auth.requireSession, async (request, response, next) => {
  const payload = request.body ?? {};

  const shiftCheck = await pool.query(
    "SELECT shift_id FROM employee_shifts WHERE user_id = $1 AND clock_out IS NULL AND (status = 'OPEN' OR status IS NULL)",
    [request.user.userId]
  );
  if (!shiftCheck.rowCount) {
    return response.status(403).json({ error: 'SHIFT_REQUIRED', message: 'You must clock in before processing sales.' });
  }
  const client = await pool.connect();
  try {
    if (!payload.orderId || !Array.isArray(payload.items) || payload.items.length === 0) return response.status(400).json({ error: 'INVALID_ORDER' });
    await client.query('BEGIN');
    const inserted = await client.query(`INSERT INTO orders (order_id, customer_id, pricing_tier_id, employee_id, order_type, status, subtotal, tax_amount, total_amount, payment_method, cash_received, change_due, created_at) VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (order_id) DO NOTHING RETURNING order_id`, [payload.orderId, payload.customerId ?? null, payload.pricingTierId, request.user.userId, payload.orderType === 'commercial' ? 'commercial' : 'retail', payload.subtotal, payload.taxAmount ?? 0, payload.totalAmount, payload.paymentMethod, payload.cashReceived ?? 0, payload.changeDue ?? 0, payload.createdAt ?? new Date().toISOString()]);
    if (inserted.rowCount === 0) { await client.query('COMMIT'); return response.json({ orderId: payload.orderId, duplicate: true }); }
    if (payload.paymentMethod === 'cash' && Number(payload.cashReceived) < Number(payload.totalAmount)) throw Object.assign(new Error('Cash received must be at least the order total'), { statusCode: 400, code: 'INSUFFICIENT_CASH' });

    for (const item of payload.items) {
      const price = await client.query('SELECT pp.price_per_unit FROM product_prices pp WHERE pp.variant_id=$1 AND pp.tier_id=$2 AND pp.min_quantity <= $3 ORDER BY pp.min_quantity DESC LIMIT 1', [item.variantId, payload.pricingTierId, item.quantity]);
      if (!price.rowCount || Number(price.rows[0].price_per_unit) !== Number(item.unitPrice)) throw Object.assign(new Error('Price changed; review the cart'), { statusCode: 409, code: 'PRICE_CHANGED' });
      const lots = await client.query('SELECT lot_id, quantity_on_hand FROM inventory_lots WHERE variant_id=$1 AND quantity_on_hand > 0 ORDER BY expiration_date NULLS LAST, lot_id FOR UPDATE', [item.variantId]);
      let remaining = Number(item.quantity);
      const allocations = item.lotId ? [{ lotId: item.lotId, quantity: remaining }] : [];
      if (!allocations.length) for (const lot of lots.rows) { if (remaining <= 0) break; const allocated = Math.min(remaining, Number(lot.quantity_on_hand)); allocations.push({ lotId: lot.lot_id, quantity: allocated }); remaining -= allocated; }
      if (remaining > 0) throw Object.assign(new Error(`Insufficient inventory for ${item.variantId}`), { statusCode: 409, code: 'INSUFFICIENT_INVENTORY' });
      for (const [allocationIndex, allocation] of allocations.entries()) { const update = await client.query('UPDATE inventory_lots SET quantity_on_hand=quantity_on_hand-$1, updated_at=now() WHERE lot_id=$2 AND variant_id=$3 AND quantity_on_hand >= $1', [allocation.quantity, allocation.lotId, item.variantId]); if (update.rowCount !== 1) throw Object.assign(new Error('Inventory changed; retry checkout'), { statusCode: 409, code: 'INVENTORY_CONFLICT' }); await client.query('INSERT INTO order_items (order_item_id, order_id, variant_id, lot_id, quantity, unit_price, total_price) VALUES ($1,$2,$3,$4,$5,$6,$7)', [allocationIndex === 0 ? item.orderItemId : crypto.randomUUID(), payload.orderId, item.variantId, allocation.lotId, allocation.quantity, item.unitPrice, Number(item.unitPrice) * allocation.quantity]); }
    }
    await client.query('COMMIT');
    return response.status(201).json({ orderId: payload.orderId, synced: true });
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); return next(error); } finally { client.release(); }
});

app.get('/api/v1/sales/report', auth.requireSession, async (request, response, next) => {
  try {
    const date = String(request.query.date ?? new Date().toISOString().slice(0, 10));
    const start = `${date}T00:00:00+08:00`;
    const result = await pool.query(`SELECT o.order_id AS "orderId", o.created_at AS "soldAt", COALESCE(c.company_name || ' - ', '') || COALESCE(c.contact_name, 'Walk-in') AS "customerName", v.sku, v.variant_name AS "itemName", oi.quantity, oi.total_price AS amount, o.payment_method AS "paymentMethod" FROM order_items oi JOIN orders o ON o.order_id=oi.order_id JOIN product_variants v ON v.variant_id=oi.variant_id LEFT JOIN customers c ON c.customer_id=o.customer_id WHERE o.status='completed' AND o.created_at >= $1::timestamptz AND o.created_at < ($1::timestamptz + interval '1 day') ORDER BY o.created_at, o.order_id, oi.order_item_id`, [start]);
    const items = result.rows.map((row) => ({ ...row, quantity: Number(row.quantity) || 0, amount: Number(row.amount) || 0 }));
    const summary = async (periodStart, periodEnd) => {
      const period = await pool.query(`SELECT COALESCE(SUM(total_amount), 0) AS gross, COUNT(order_id)::int AS orders FROM orders WHERE status='completed' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz`, [periodStart, periodEnd]);
      return { grossTotal: Number(period.rows[0].gross) || 0, netTotal: Number(period.rows[0].gross) || 0, orderCount: period.rows[0].orders };
    };
    const selected = new Date(`${date}T00:00:00Z`);
    const monday = new Date(selected); const day = monday.getUTCDay(); monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1));
    const nextMonth = new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth() + 1, 1));
    const nextYear = new Date(Date.UTC(selected.getUTCFullYear() + 1, 0, 1));
    const dateString = (value) => value.toISOString().slice(0, 10);
    const periodBounds = (startDate, endDate) => [`${startDate}T00:00:00+08:00`, `${endDate}T00:00:00+08:00`];
    const weekStart = dateString(monday); const weekEnd = dateString(new Date(monday.getTime() + 7 * 86400000));
    const monthStart = `${selected.getUTCFullYear()}-${String(selected.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const yearStart = `${selected.getUTCFullYear()}-01-01`;
    const [week, month, year] = request.user.role === 'admin' ? await Promise.all([summary(...periodBounds(weekStart, weekEnd)), summary(...periodBounds(monthStart, dateString(nextMonth))), summary(...periodBounds(yearStart, dateString(nextYear)))]) : [null, null, null];
    response.json({ selectedDate: date, items, dayGrossTotal: items.reduce((total, item) => total + item.amount, 0), dayNetTotal: items.reduce((total, item) => total + item.amount, 0), dayOrderCount: new Set(items.map((item) => item.orderId)).size, week: week && { ...week, startDate: weekStart, endDate: weekEnd }, month: month && { ...month, startDate: monthStart, endDate: dateString(nextMonth) }, year: year && { ...year, startDate: yearStart, endDate: dateString(nextYear) }, timezone: 'Asia/Manila' });
  } catch (error) { next(error); }
});

app.use((error, _request, response, _next) => { console.error(error); response.status(error.statusCode ?? 500).json({ error: error.code ?? 'INTERNAL_ERROR', message: process.env.NODE_ENV === 'production' ? undefined : error.message }); });


async function ensureShiftColumns() {
  try {
    await pool.query(`
      ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS opening_float NUMERIC(12,2) DEFAULT 1500.00;
      ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS closing_cash_count NUMERIC(12,2);
      ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS expected_cash NUMERIC(12,2);
      ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS cash_discrepancy NUMERIC(12,2);
      ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'OPEN';
      ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS notes TEXT;
    `);
  } catch (err) {
    console.error('Error adding shift columns:', err.message);
  }
}

async function autoCloseOvernightShifts() {
  try {
    await pool.query(`
      UPDATE employee_shifts
      SET clock_out = ((clock_in AT TIME ZONE 'Asia/Manila')::date + time '23:59:59') AT TIME ZONE 'Asia/Manila',
          status = 'PENDING_PHYSICAL_COUNT'
      WHERE clock_out IS NULL 
        AND (status = 'OPEN' OR status IS NULL)
        AND (clock_in AT TIME ZONE 'Asia/Manila')::date < (now() AT TIME ZONE 'Asia/Manila')::date
    `);
  } catch (err) {
    console.error('Error auto-closing overnight shifts:', err.message);
  }
}

async function start(port = Number(process.env.PORT ?? 3000)) {
  await migrate();
  await ensureShiftColumns();
  await autoCloseOvernightShifts();
  setInterval(autoCloseOvernightShifts, 15 * 60 * 1000);
  return app.listen(port, () => console.log(`Bake Alley cloud API listening on ${port}`));
}
if (require.main === module) start().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { app, start };
