const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
require('dotenv').config();
const { pool, migrate } = require('./db');
const { createAuthRouter } = require('./auth');
const logger = require('./logger');
const { validate, customerSchema, employeeSchema, inventoryAdjustSchema, inventoryProductSchema, inventoryUpdateSchema, orderPayloadSchema } = require('./validation');

const app = express();

// CORS configuration - restrict to whitelisted origins
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'https://rpg1886.github.io,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map(origin => origin.trim());

logger.info('CORS allowed origins', { allowedOrigins });

app.use(cors({
  origin: (origin, callback) => {
    logger.info('CORS request received', { origin, isAllowed: !origin || allowedOrigins.some(allowed => allowed.toLowerCase() === (origin || '').toLowerCase()) });
    if (!origin || allowedOrigins.some(allowed => allowed.toLowerCase() === origin.toLowerCase())) {
      callback(null, true);
    } else {
      logger.warn('CORS request blocked', { origin, allowedOrigins });
      callback(new Error('CORS not allowed'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting middleware
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware to attach pool to request
app.use((request, response, next) => {
  request.pool = pool;
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use('/api/v1', apiLimiter);

const auth = createAuthRouter(express, pool);
app.use('/api/v1', auth.router);
app.post('/api/v1/auth/login', loginLimiter, (request, response, next) => next());

app.get('/api/v1/health', async (_request, response, next) => {
  try { 
    await pool.query('SELECT 1'); 
    response.json({ ok: true }); 
  } catch (error) { 
    logger.error('Health check failed', { error: error.message });
    next(error); 
  }
});

app.get('/api/v1/version', (_request, response) => {
  response.json({ version: process.env.APP_VERSION ?? '0.1.0-cloud' });
});

// Category List Endpoint
app.get('/api/v1/categories', auth.requireSession, async (_request, response, next) => {
  try {
    const result = await pool.query('SELECT category_id AS "categoryId", name FROM categories ORDER BY name');
    response.json(result.rows);
  } catch (error) {
    logger.error('Categories list failed', { error: error.message });
    next(error);
  }
});

// Product Search Endpoint with True Category Filtering
app.get('/api/v1/products/search', auth.requireSession, async (request, response, next) => {
  try {
    const q = String(request.query.q ?? '').trim();
    const categoryId = String(request.query.categoryId ?? request.query.category ?? '').trim();

    const whereConditions = [];
    const params = [];

    // Filter by Category ID (UUID) or Category Name String
    if (categoryId) {
      params.push(categoryId);
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryId)) {
        whereConditions.push(`p.category_id = $${params.length}`);
      } else {
        whereConditions.push(`c.name ILIKE $${params.length}`);
      }
    }

    // Filter by Text Search Query
    if (q) {
      params.push(`%${q}%`);
      const paramIdx = params.length;
      whereConditions.push(`(v.sku ILIKE $${paramIdx} OR v.barcode ILIKE $${paramIdx} OR v.variant_name ILIKE $${paramIdx} OR p.name ILIKE $${paramIdx} OR c.name ILIKE $${paramIdx})`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT v.variant_id AS "variantId", v.sku, v.variant_name AS name, u.symbol AS unit, p.is_sold_by_weight AS "soldByWeight", pp.tier_id AS "tierId", pp.min_quantity AS "minQuantity", pp.price_per_unit AS "pricePerUnit", p.category_id AS "categoryId", c.name AS "categoryName" 
       FROM product_variants v 
       JOIN products p ON p.product_id=v.product_id 
       JOIN units_of_measure u ON u.uom_id=p.base_uom_id 
       LEFT JOIN categories c ON c.category_id=p.category_id 
       LEFT JOIN product_prices pp ON pp.variant_id=v.variant_id 
       ${whereClause} 
       ORDER BY v.variant_name LIMIT 50`, 
      params
    );

    const grouped = new Map();
    for (const row of result.rows) { 
      if (!grouped.has(row.variantId)) {
        grouped.set(row.variantId, { 
          variantId: row.variantId, 
          sku: row.sku, 
          name: row.name, 
          unit: row.unit, 
          soldByWeight: row.soldByWeight,
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          prices: [] 
        }); 
      }
      if (row.tierId) {
        grouped.get(row.variantId).prices.push({ tierId: row.tierId, minQuantity: Number(row.minQuantity), pricePerUnit: Number(row.pricePerUnit) }); 
      }
    }
    response.json([...grouped.values()]);
  } catch (error) { 
    logger.error('Product search failed', { error: error.message });
    next(error); 
  }
});

app.get('/api/v1/units-of-measure', auth.requireSession, async (_request, response, next) => {
  try {
    const result = await pool.query('SELECT uom_id AS "uomId", name, symbol FROM units_of_measure ORDER BY name');
    response.json(result.rows);
  } catch (error) {
    logger.error('Units of measure fetch failed', { error: error.message });
    next(error);
  }
});

app.get('/api/v1/customers', auth.requireSession, async (_request, response, next) => {
  try { 
    const result = await pool.query(`SELECT c.customer_id AS "customerId", COALESCE(c.company_name || ' - ', '') || c.contact_name AS "displayName", 
      c.email, c.phone, c.tier_id AS "tierId",COALESCE(SUM(o.total_amount), 0)::numeric AS "totalSpent"  FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id AND o.status = 'completed' 
      GROUP BY c.customer_id, c.company_name, c.contact_name, c.email, c.phone, c.tier_id ORDER BY c.contact_name`); 
    const customers = result.rows.map((row) => ({ ...row, totalSpent: Number(row.totalSpent) || 0, }));
    response.json(customers); 
  } catch (error) { 
    logger.error('Customer list failed', { error: error.message });
    next(error); 
  }
});

app.post('/api/v1/customers', auth.requireSession, async (request, response, next) => {
  try {
    const validation = validate(customerSchema, request.body);
    if (!validation.success) {
      logger.warn('Customer validation failed', { errors: validation.errors });
      return response.status(400).json({ error: 'INVALID_CUSTOMER', details: validation.errors });
    }

    const body = validation.data;
    const result = await pool.query(
      `INSERT INTO customers (customer_id, company_name, contact_name, email, phone, tier_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       RETURNING customer_id AS "customerId", COALESCE(company_name || ' - ', '') || contact_name AS "displayName", email, phone, tier_id AS "tierId"`, 
      [body.companyName ?? null, body.contactName, body.email ?? null, body.phone ?? null, body.tierId]
    );
    logger.info('Customer created', { customerId: result.rows[0].customerId });
    response.status(201).json({ ...result.rows[0], totalSpent: 0 });
  } catch (error) { 
    logger.error('Customer creation failed', { error: error.message });
    next(error); 
  }
});

app.delete('/api/v1/customers/:id', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  try {
    const protectedCustomer = await pool.query('SELECT 1 FROM orders WHERE customer_id = \$1 LIMIT 1', [request.params.id]);
    if (protectedCustomer.rowCount) {
      logger.warn('Customer deletion blocked - has orders', { customerId: request.params.id });
      return response.status(409).json({ error: 'CUSTOMER_HAS_ORDERS' });
    }
    const result = await pool.query('DELETE FROM customers WHERE customer_id = \$1', [request.params.id]);
    if (!result.rowCount) return response.status(404).json({ error: 'CUSTOMER_NOT_FOUND' });
    logger.info('Customer deleted', { customerId: request.params.id });
    response.status(204).end();
  } catch (error) { 
    logger.error('Customer deletion failed', { error: error.message });
    next(error); 
  }
});

app.get('/api/v1/inventory', auth.requireSession, async (_request, response, next) => {
  try { 
    const result = await pool.query(
      `SELECT v.variant_id AS "variantId", v.sku, v.variant_name AS "variantName", COALESCE(SUM(l.quantity_on_hand), 0) AS "quantityOnHand", MIN(l.expiration_date) AS "expirationDate", COALESCE(p.initial_cost, 0) AS "initialCapital", COALESCE((SELECT pp.price_per_unit FROM product_prices pp JOIN price_tiers pt ON pt.tier_id=pp.tier_id WHERE pp.variant_id=v.variant_id AND lower(pt.tier_name)='retail' ORDER BY pp.min_quantity LIMIT 1), 0) AS "retailPrice" 
       FROM product_variants v 
       JOIN products p ON p.product_id=v.product_id 
       LEFT JOIN inventory_lots l ON l.variant_id=v.variant_id 
       GROUP BY v.variant_id, v.sku, v.variant_name, p.initial_cost 
       ORDER BY v.variant_name`
    ); 
    response.json(result.rows.map((row) => ({ 
      ...row, 
      quantityOnHand: Number(row.quantityOnHand) || 0, 
      initialCapital: Number(row.initialCapital) || 0, 
      retailPrice: Number(row.retailPrice) || 0 
    }))); 
  } catch (error) { 
    logger.error('Inventory list failed', { error: error.message });
    next(error); 
  }
});

app.post('/api/v1/inventory/adjust', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  try {
    const validation = validate(inventoryAdjustSchema, request.body);
    if (!validation.success) {
      logger.warn('Inventory adjustment validation failed', { errors: validation.errors });
      return response.status(400).json({ error: 'INVALID_INVENTORY_ADJUSTMENT', details: validation.errors });
    }

    const body = validation.data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const variant = await client.query('SELECT variant_id FROM product_variants WHERE variant_id=\$1 FOR UPDATE', [body.variantId]);
      if (!variant.rowCount) throw Object.assign(new Error('Variant not found'), { statusCode: 404, code: 'VARIANT_NOT_FOUND' });
      
      const lotNumber = body.lotNumber || `CLOUD-${body.variantId.slice(0, 8)}-${body.expirationDate || 'NOEXPIRY'}`;
      await client.query(
        `INSERT INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand) VALUES (gen_random_uuid(), $1, $2, $3, $4)
         ON CONFLICT (variant_id, lot_number) DO UPDATE SET expiration_date=EXCLUDED.expiration_date, quantity_on_hand=EXCLUDED.quantity_on_hand, updated_at=now()`, 
        [body.variantId, lotNumber, body.expirationDate || null, body.quantity]
      );
      
      if (body.retailPrice !== undefined) {
        const retailTier = await client.query("SELECT tier_id FROM price_tiers WHERE lower(tier_name)='retail' LIMIT 1");
        if (!retailTier.rowCount) throw Object.assign(new Error('Retail tier is not configured'), { statusCode: 409, code: 'RETAIL_TIER_NOT_FOUND' });
        await client.query(
          `INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity) VALUES (gen_random_uuid(), $1, $2, $3, 0)
           ON CONFLICT (variant_id, tier_id, min_quantity) DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit`, 
          [body.variantId, retailTier.rows[0].tier_id, body.retailPrice]
        );
      }
      await client.query('COMMIT');
      logger.info('Inventory adjusted', { variantId: body.variantId, quantity: body.quantity });
      response.status(200).json({ updated: true });
    } catch (error) { 
      await client.query('ROLLBACK').catch(() => undefined); 
      throw error;
    } finally { 
      client.release(); 
    }
  } catch (error) { 
    logger.error('Inventory adjustment failed', { error: error.message });
    next(error); 
  }
});

app.post('/api/v1/inventory/products', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  try {
    const validation = validate(inventoryProductSchema, request.body);
    if (!validation.success) {
      logger.warn('Product creation validation failed', { errors: validation.errors });
      return response.status(400).json({ error: 'INVALID_PRODUCT_INVENTORY', details: validation.errors });
    }

    const body = validation.data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const retailTier = await client.query("SELECT tier_id FROM price_tiers WHERE lower(tier_name)='retail' LIMIT 1");
      if (!retailTier.rowCount) throw Object.assign(new Error('Retail tier is not configured'), { statusCode: 409, code: 'RETAIL_TIER_NOT_FOUND' });
      
      const product = await client.query(
        `INSERT INTO products (product_id, name, base_uom_id, is_sold_by_weight, requires_lot_tracking, initial_cost) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING product_id`, 
        [body.name, body.baseUomId, body.soldByWeight || false, body.requiresLotTracking || false, body.initialCost || 0]
      );
      
      const variant = await client.query(
        `INSERT INTO product_variants (variant_id, product_id, sku, barcode, variant_name) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING variant_id AS "variantId", sku, variant_name AS "variantName"`, 
        [product.rows[0].product_id, body.sku, body.barcode || null, body.variantName]
      );
      
      await client.query(
        'INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity) VALUES (gen_random_uuid(), \$1, \$2, \$3, 0)', 
        [variant.rows[0].variantId, retailTier.rows[0].tier_id, body.retailPrice]
      );
      
      await client.query(
        'INSERT INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand) VALUES (gen_random_uuid(), \$1, \$2, \$3, \$4)', 
        [variant.rows[0].variantId, body.lotNumber, body.expirationDate || null, body.quantity]
      );
      
      await client.query('COMMIT');
      logger.info('Product created', { variantId: variant.rows[0].variantId, sku: body.sku });
      response.status(201).json(variant.rows[0]);
    } catch (error) { 
      await client.query('ROLLBACK').catch(() => undefined); 
      throw error;
    } finally { 
      client.release(); 
    }
  } catch (error) { 
    logger.error('Product creation failed', { error: error.message, code: error.code, detail: error.detail, constraint: error.constraint });
  }
});

app.put('/api/v1/inventory/products/:variantId', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  try {
    const { variantId } = request.params;
    if (!variantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(variantId)) {
      return response.status(400).json({ error: 'INVALID_VARIANT_ID', message: 'Variant ID must be a valid UUID' });
    }

    const validation = validate(inventoryUpdateSchema, request.body);
    if (!validation.success) {
      logger.warn('Inventory update validation failed', { variantId, errors: validation.errors });
      return response.status(400).json({ error: 'INVALID_INVENTORY_UPDATE', details: validation.errors });
    }

    const body = validation.data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update variant if variantName or sku provided
      if (body.variantName || body.sku) {
        const updateFields = [];
        const params = [];
        let paramIndex = 1;
        if (body.variantName) {
          updateFields.push(`variant_name=$${paramIndex++}`);
          params.push(body.variantName);
        }
        if (body.sku) {
          updateFields.push(`sku=$${paramIndex++}`);
          params.push(body.sku);
        }
        params.push(variantId);
        await client.query(
          `UPDATE product_variants SET ${updateFields.join(', ')}, updated_at=now() WHERE variant_id=$${paramIndex}`,
          params
        );
      }

      // Update product initial_cost if provided
      if (body.initialCost !== undefined) {
        await client.query(
          'UPDATE products SET initial_cost=\$1, updated_at=now() WHERE product_id=(SELECT product_id FROM product_variants WHERE variant_id=\$2)',
          [body.initialCost, variantId]
        );
      }

      // Update retail price in product_prices if provided
      if (body.retailPrice !== undefined) {
        const tierResult = await client.query(
          "SELECT tier_id FROM price_tiers WHERE lower(tier_name)='retail' LIMIT 1"
        );
        if (tierResult.rows[0]) {
          const retailTierId = tierResult.rows[0].tier_id;
          await client.query(
            `INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity) 
             VALUES (gen_random_uuid(), $1, $2, $3, 0)
             ON CONFLICT (variant_id, tier_id, min_quantity) DO UPDATE SET price_per_unit=$3, updated_at=now()`,
            [variantId, retailTierId, body.retailPrice]
          );
        }
      }

      // Update inventory quantity if provided
      if (body.quantity !== undefined) {
        const lots = await client.query(
          'SELECT lot_id, quantity_on_hand FROM inventory_lots WHERE variant_id=\$1 ORDER BY expiration_date NULLS LAST LIMIT 1',
          [variantId]
        );
        if (lots.rows[0]) {
          await client.query(
            'UPDATE inventory_lots SET quantity_on_hand=\$1, updated_at=now() WHERE lot_id=\$2',
            [body.quantity, lots.rows[0].lot_id]
          );
        }
      }

      // Update lot if lotNumber or expirationDate provided
      if (body.lotNumber || body.expirationDate !== undefined) {
        const updateFields = [];
        const params = [];
        let paramIndex = 1;
        if (body.lotNumber) {
          updateFields.push(`lot_number=$${paramIndex++}`);
          params.push(body.lotNumber);
        }
        if (body.expirationDate !== undefined) {
          updateFields.push(`expiration_date=$${paramIndex++}`);
          params.push(body.expirationDate || null);
        }
        params.push(variantId);
        if (updateFields.length > 0) {
          await client.query(
            `UPDATE inventory_lots SET ${updateFields.join(', ')}, updated_at=now() WHERE variant_id=$${paramIndex} AND quantity_on_hand > 0 AND lot_id=(SELECT lot_id FROM inventory_lots WHERE variant_id=$${paramIndex} AND quantity_on_hand > 0 ORDER BY expiration_date NULLS LAST LIMIT 1)`,
            params
          );
        }
      }

      await client.query('COMMIT');
      logger.info('Inventory updated', { variantId, changes: Object.keys(body) });
      response.status(200).json({ message: 'Inventory updated successfully' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Inventory update failed', { error: error.message, code: error.code, detail: error.detail });
    next(Object.assign(error, { statusCode: 400 }));
  }
});

// Employee Roster List Endpoint (Date-Filtered Sales Totals)
app.get('/api/v1/employees', auth.requireSession, async (request, response, next) => {
  try {
    const rawDate = String(request.query.date ?? '').trim();
    const match = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
    const date = match ? match[1] : null;

    let dateFilter = '';
    const params = [request.user.role, request.user.userId];

    if (date) {
      params.push(`${date}T00:00:00+08:00`);
      dateFilter = `AND o.created_at >= $3::timestamptz AND o.created_at < ($3::timestamptz + interval '1 day')`;
    }

    const result = await pool.query(
      `SELECT u.user_id AS "userId", u.username, u.display_name AS "displayName", u.role, u.active,
       COUNT(o.order_id)::int AS "salesCount", COALESCE(SUM(o.total_amount), 0)::numeric AS "salesAmount"
       FROM app_users u 
       LEFT JOIN orders o ON o.employee_id = u.user_id AND o.status = 'completed' ${dateFilter}
       WHERE u.active = TRUE AND ($1 = 'admin' OR u.user_id = $2) 
       GROUP BY u.user_id 
       ORDER BY u.display_name`, 
      params
    );
    response.json(result.rows.map(row => ({ ...row, salesAmount: Number(row.salesAmount) || 0 })));
  } catch (error) { 
    logger.error('Employees list failed', { error: error.message });
    next(error); 
  }
});

app.post('/api/v1/employees', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  try {
    const validation = validate(employeeSchema, request.body);
    if (!validation.success) {
      logger.warn('Employee creation validation failed', { errors: validation.errors });
      return response.status(400).json({ error: 'INVALID_EMPLOYEE', details: validation.errors });
    }

    const body = validation.data;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(body.password), salt, 64).toString('hex');
    // Check if employee already exists (active or inactive)
    const existing = await pool.query('SELECT user_id, active FROM app_users WHERE username = lower($1)', [body.username]);
    if (existing.rowCount > 0) {
      const user = existing.rows[0];
      if (user.active) {
        return response.status(409).json({ error: 'USERNAME_EXISTS', message: 'An active employee with this username already exists' });
      }
      // Reactivate previously soft-deleted employee with new credentials
      const reactivated = await pool.query(
        `UPDATE app_users SET display_name = $1, role = $2, password_salt = $3, password_hash = $4, active = TRUE, updated_at = now() WHERE user_id = $5 RETURNING user_id AS "userId", username, display_name AS "displayName", role, active`,
        [body.displayName, body.role, salt, hash, user.user_id]
      );
      logger.info('Employee reactivated', { userId: user.user_id, username: body.username });
      return response.status(200).json(reactivated.rows[0]);
    }
    const result = await pool.query(
      `INSERT INTO app_users (user_id, username, display_name, role, password_salt, password_hash)
       VALUES (gen_random_uuid(), lower($1), $2, $3, $4, $5)
       RETURNING user_id AS "userId", username, display_name AS "displayName", role, active`, 
      [body.username, body.displayName, body.role, salt, hash]
    );
    logger.info('Employee created', { userId: result.rows[0].userId, username: body.username });
    response.status(201).json(result.rows[0]);
  } catch (error) { 
    logger.error('Employee creation failed', { error: error.message });
    next(error); 
  }
});

app.post('/api/v1/employees/clock-in', auth.requireSession, async (request, response, next) => {
  try {
    await autoCloseOvernightShifts();
    const payload = request.body ?? {};
    const rawFloat = payload.openingFloat !== undefined && payload.openingFloat !== null ? Number(payload.openingFloat) : 1500.00;
    const openingFloat = Number.isFinite(rawFloat) && rawFloat >= 0 ? rawFloat : 1500.00;
    const notes = typeof payload.notes === 'string' ? payload.notes.trim() : null;

    const openShiftCheck = await pool.query(
      `SELECT shift_id AS "shiftId", clock_in AS "clockIn", COALESCE(opening_float, 1500.00)::numeric AS "openingFloat", COALESCE(status, 'OPEN') AS status 
       FROM employee_shifts 
       WHERE user_id = $1 AND clock_out IS NULL
       ORDER BY clock_in DESC LIMIT 1`,
      [request.user.userId]
    );

    if (openShiftCheck.rowCount > 0) {
      return response.json(openShiftCheck.rows[0]);
    }

    const result = await pool.query(
      `INSERT INTO employee_shifts (shift_id, user_id, clock_in, opening_float, status, notes) 
       VALUES (gen_random_uuid(), $1, now(), $2, 'OPEN', $3) 
       RETURNING shift_id AS "shiftId", user_id AS "userId", clock_in AS "clockIn", COALESCE(opening_float, 1500.00)::numeric AS "openingFloat", COALESCE(status, 'OPEN') AS status, notes`, 
      [request.user.userId, openingFloat, notes]
    );

    logger.info('Employee clocked in with opening float', { userId: request.user.userId, openingFloat });
    response.status(201).json(result.rows[0]);
  } catch (error) { 
    logger.error('Clock-in failed', { error: error.message });
    next(error); 
  }
});

app.post('/api/v1/employees/clock-out', auth.requireSession, async (request, response, next) => {
  try {
    const payload = request.body ?? {};
    const rawClosingCount = payload.closingCashCount !== undefined && payload.closingCashCount !== null ? Number(payload.closingCashCount) : null;
    const closingCashCount = rawClosingCount !== null && Number.isFinite(rawClosingCount) && rawClosingCount >= 0 ? rawClosingCount : null;
    const notes = typeof payload.notes === 'string' ? payload.notes.trim() : null;

    const openShiftCheck = await pool.query(
      `SELECT shift_id AS "shiftId", clock_in AS "clockIn", clock_out AS "clockOut", COALESCE(opening_float, 1500.00)::numeric AS "openingFloat", COALESCE(status, 'OPEN') AS status
       FROM employee_shifts
       WHERE user_id = $1 AND clock_out IS NULL
       ORDER BY clock_in DESC LIMIT 1`,
      [request.user.userId]
    );

    if (!openShiftCheck.rowCount) {
      logger.warn('Clock-out failed - no open shift', { userId: request.user.userId });
      return response.status(409).json({ error: 'NO_OPEN_SHIFT' });
    }

    const openShift = openShiftCheck.rows[0];
    const clockInTime = openShift.clockIn;
    const openingFloat = Number(openShift.openingFloat) || 1500.00;

    const salesResult = await pool.query(
      `SELECT COALESCE(SUM(
         CASE 
           WHEN o.payment_method ILIKE '%cash%' THEN oi.total_price 
           ELSE 0 
         END
       ), 0)::numeric AS "shiftCashSales"
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.order_id
       WHERE o.employee_id = $1
         AND o.status = 'completed'
         AND o.created_at >= $2::timestamptz
         AND o.created_at <= COALESCE($3::timestamptz, now())`,
      [request.user.userId, clockInTime, openShift.clockOut || null]
    );

    const shiftCashSales = Number(salesResult.rows[0].shiftCashSales) || 0;
    const expectedCash = openingFloat + shiftCashSales;
    const cashDiscrepancy = closingCashCount !== null ? closingCashCount - expectedCash : null;
    const finalStatus = 'CLOSED';

    const result = await pool.query(
      `UPDATE employee_shifts 
       SET clock_out = COALESCE(clock_out, now()),
           closing_cash_count = $2,
           expected_cash = $3,
           cash_discrepancy = $4,
           status = $5,
           notes = COALESCE($6, notes)
       WHERE shift_id = $1 
       RETURNING shift_id AS "shiftId", user_id AS "userId", clock_in AS "clockIn", clock_out AS "clockOut", COALESCE(opening_float, 1500.00)::numeric AS "openingFloat", closing_cash_count AS "closingCashCount", expected_cash AS "expectedCash", cash_discrepancy AS "cashDiscrepancy", COALESCE(status, 'CLOSED') AS status, notes`, 
      [openShift.shiftId, closingCashCount, expectedCash, cashDiscrepancy, finalStatus, notes]
    );

    logger.info('Employee clocked out with cash drawer reconciliation', { 
      userId: request.user.userId, 
      openingFloat, 
      shiftCashSales, 
      expectedCash, 
      closingCashCount, 
      cashDiscrepancy 
    });
    response.json(result.rows[0]);
  } catch (error) { 
    logger.error('Clock-out failed', { error: error.message });
    next(error); 
  }
});

app.delete('/api/v1/employees/:userId', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  try {
    const { userId } = request.params;
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return response.status(400).json({ error: 'INVALID_USER_ID', message: 'User ID must be a valid UUID' });
    }

    if (userId === request.user.userId) { 
      return response.status(400).json({ error: 'CANNOT_DELETE_SELF', 
      message: 'You cannot delete your own logged-in admin account' });
    }

    const userCheck = await pool.query('SELECT user_id, username FROM app_users WHERE user_id = $1 AND active = TRUE', [userId]);
    if (!userCheck.rowCount) {
      return response.status(404).json({
        error: 'USER_NOT_FOUND', message:
          'Employee not found or already deactivated' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE app_users SET active = FALSE, updated_at = now() WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await client.query('COMMIT');
      logger.info('Employee deactivated', { userId, username: userCheck.rows[0].username });
      response.status(200).json({ message: 'Employee deactivated successfully', active: false });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Employee deletion failed', { error: error.message });
    next(error);
  }
});

app.post('/api/v1/employees/:userId/reset-password', auth.requireSession, auth.requireAdmin, async(request, response, next) => {
  try {
    const { userId } = request.params; 
    const { password } = request.body ?? {};

    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return response.status(400).json({ error: 'INVALID\_USER\_ID', message: 'User ID must be a valid UUID' });
    }

    if (!password || String(password).length < 12) { 
      return response.status(400).json({ error: 'PASSWORD_TOO_SHORT',
        message: 'New Password must be at least 12 characters' });
    }

    const userCheck = await pool.query('SELECT user_id, username FROM app_users WHERE user_id = $1 AND active = TRUE', [userId]);
    if (!userCheck.rowCount) {
      return response.status(404).json({ error: 'USER_NOT_FOUND', message: 'Employee not found or inactive' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    const client = await pool.connect();
    try { 
      await client.query('BEGIN');
      await client.query(
        'UPDATE app\_users SET password\_salt = $1, password\_hash = $2, updated\_at = now() WHERE user\_id = $3',
        [salt, hash, userId]);
      await client.query('DELETE FROM sessions WHERE user\_id = $1', [userId]);  
      await client.query('COMMIT');
      logger.info('Employee password reset by admin', { targetUserId: userId, adminUserId: request.user.userId });
      response.status(200).json({ message: 'Password reset successfully' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Employee password reset failed', { error: error.message });
    next(error);
  }
});

// Employee Shifts List Endpoint (Strict YYYY-MM-DD Date Filter)
app.get('/api/v1/employees/shifts', auth.requireSession, async (request, response, next) => {
  try {
    await autoCloseOvernightShifts();
    const rawDate = String(request.query.date ?? '').trim();
    const match = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
    const date = match ? match[1] : null;

    let dateFilter = '';
    const params = [request.user.role, request.user.userId];

    if (date) {
      params.push(`${date}T00:00:00+08:00`);
      dateFilter = `AND s.clock_in >= $3::timestamptz AND s.clock_in < ($3::timestamptz + interval '1 day')`;
    }

    const result = await pool.query(
      `SELECT s.shift_id AS "shiftId", s.user_id AS "userId", u.display_name AS "displayName", u.role AS "role", s.clock_in AS "clockIn", s.clock_out AS "clockOut", COALESCE(s.opening_float, 1500.00)::numeric AS "openingFloat", s.closing_cash_count AS "closingCashCount", s.expected_cash AS "expectedCash", s.cash_discrepancy AS "cashDiscrepancy", COALESCE(s.status, CASE WHEN s.clock_out IS NULL THEN 'OPEN' ELSE 'CLOSED' END) AS status, s.notes 
       FROM employee_shifts s 
       JOIN app_users u ON u.user_id=s.user_id 
       WHERE ($1 = 'admin' OR s.user_id = $2) ${dateFilter} 
       ORDER BY s.clock_in DESC LIMIT 100`, 
      params
    );
    response.json(result.rows);
  } catch (error) { 
    logger.error('Shifts list failed', { error: error.message });
    next(error); 
  }
});

app.post('/api/v1/orders', auth.requireSession, async (request, response, next) => {
  const payload = request.body ?? {};
  const validation = validate(orderPayloadSchema, payload);
  if (!validation.success) {
    logger.warn('Order validation failed', { errors: validation.errors });
    return response.status(400).json({ error: 'INVALID_ORDER', details: validation.errors });
  }

  const validatedPayload = validation.data;

  if (request.user.role !== 'admin') {
    const openShiftCheck = await pool.query(
      `SELECT shift_id FROM employee_shifts WHERE user_id = $1 AND clock_out IS NULL AND (status = 'OPEN' OR status IS NULL)`,
      [request.user.userId]
    );
    if (!openShiftCheck.rowCount) {
      return response.status(403).json({
        error: 'SHIFT_REQUIRED',
        message: 'You must clock in and set your opening float before processing sales.'
      });
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Calculate changeDue and total cash received server-side
    let changeDue = 0;
    let totalCashReceived = Number(validatedPayload.cashReceived || 0);

    if (validatedPayload.paymentMethod === 'split' && Array.isArray(validatedPayload.payments)) {
     const cashPayment = validatedPayload.payments.filter(p => p.method === 'cash');
      if (cashPayment.length > 0) {
        const totalCashNeeded = cashPayment.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const totalCashTenderedInSplit = cashPayment.reduce((sum, p) => sum + Number(p.cashReceived || p.amount || 0), 0);
        if (totalCashTenderedInSplit < totalCashNeeded) { throw Object.assign(new Error('Cash received must be at least the cash portion total'), { statusCode: 400, code: 'INSUFFICIENT_CASH' }); }
        changeDue = Math.max(0, totalCashTenderedInSplit - totalCashNeeded);
        totalCashReceived = totalCashTenderedInSplit;
      }
    } else if (validatedPayload.paymentMethod === 'cash') { 
      const requiredCashToday = orderMode === 'reservation' ? depositAmount : Number(validatedPayload.totalAmount || 0);
      if (requiredCashToday > 0 && totalCashReceived < requiredCashToday) {
        throw Object.assign(new Error('Cash received must be at least the deposit required'),
          { statusCode: 400, code: 'INSUFFICIENT_CASH' }
        );
      }
      changeDue = Math.max(0, totalCashReceived - requiredCashToday);
    }
    
    const orderMode = validatedPayload.orderMode || 'immediate';
    const depositAmount = Number(validatedPayload.depositAmount || 0);
    const totalAmount = Number(validatedPayload.totalAmount || 0);
    const balanceDue = validatedPayload.balanceDue !== undefined ? Number(validatedPayload.balanceDue) : Math.max(0, totalAmount - depositAmount);

    let reservationStatus = validatedPayload.reservationStatus;
    if (orderMode === 'reservation' && !reservationStatus) {
      if (balanceDue <= 0) reservationStatus = 'fully_prepaid';
      else if (depositAmount > 0) reservationStatus = 'partially_paid';
      else reservationStatus = 'unpaid';
    }

    const orderStatus = orderMode === 'reservation' ? 'open' : 'completed';

    const inserted = await client.query(
      `INSERT INTO orders (order_id, customer_id, pricing_tier_id, employee_id, order_type, status, subtotal, tax_amount, 
      total_amount, payment_method, cash_received, change_due, payments, created_at,order_mode, fulfillment_date, deposit_amount, balance_due, reservation_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (order_id) DO NOTHING RETURNING order_id`, 
      [
        validatedPayload.orderId, 
        validatedPayload.customerId ?? null, 
        validatedPayload.pricingTierId, 
        request.user.userId, 
        validatedPayload.orderType === 'commercial' ? 'commercial' : 'retail', 
        orderStatus,
        validatedPayload.subtotal, 
        validatedPayload.taxAmount ?? 0, 
        totalAmount, 
        validatedPayload.paymentMethod, 
        totalCashReceived, 
        changeDue,
        validatedPayload.payments ? JSON.stringify(validatedPayload.payments) : null,
        validatedPayload.createdAt ?? new Date().toISOString(),
        orderMode,
        validatedPayload.fulfillmentDate ?? null,
        depositAmount,
        balanceDue,
        reservationStatus ?? null
      ]
    );
    
    if (inserted.rowCount === 0) { 
      await client.query('COMMIT');
      logger.info('Order is duplicate (idempotent)', { orderId: validatedPayload.orderId });
      return response.json({ orderId: validatedPayload.orderId, duplicate: true }); 
    }

    // Record returned quantities on original order items and restock inventory
    if (Array.isArray(validatedPayload.returnedItems)) {
      for (const retItem of validatedPayload.returnedItems) {
        if (retItem.orderItemId) {
          await client.query(
            'UPDATE order_items SET returned_quantity = COALESCE(returned_quantity, 0) + $1 WHERE order_item_id = $2', 
            [retItem.quantity, retItem.orderItemId]);
        } 
        if (retItem.restock && retItem.lotId) {
          await client.query(
            'UPDATE inventory_lots SET quantity_on_hand = quantity_on_hand + $1, updated_at = now() WHERE lot_id = $2 AND variant_id = $3', [retItem.quantity, retItem.lotId, retItem.variantId]);
        }
      }
    }

    if (orderMode === 'reservation') {
      for (const item of validatedPayload.items) {
        const lotRes = await client.query(
          'SELECT lot_id FROM inventory_lots WHERE variant_id = $1 ORDER BY expiration_date NULLS LAST LIMIT 1',
          [item.variantId]
        );
        const lotId = item.lotId || lotRes.rows[0]?.lot_id || null;
        await client.query(
          'INSERT INTO order_items (order_item_id, order_id, variant_id, lot_id, quantity, unit_price, total_price) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [item.orderItemId || crypto.randomUUID(),
            validatedPayload.orderId,
            item.variantId,
            lotId,
            item.quantity,
            item.unitPrice,
            Number(item.unitPrice) * Number(item.quantity)]);
      }
    } else {
    for (const item of validatedPayload.items) {
      let price = await client.query(
        'SELECT pp.price_per_unit FROM product_prices pp WHERE pp.variant_id=$1 AND pp.tier_id=$2 AND pp.min_quantity <= $3 ORDER BY pp.min_quantity DESC LIMIT 1', 
        [item.variantId, validatedPayload.pricingTierId, item.quantity]
      );

      if (!price.rowCount) {
        price = await client.query(
          'SELECT pp.price_per_unit FROM product_prices pp WHERE pp.variant_id=$1 AND pp.price_per_unit > 0 ORDER BY pp.min_quantity ASC LIMIT 1',
          [item.variantId]
        );
      }

      const serverPrice = Number(price.rows[0]?.price_per_unit || 0);
      const clientPrice = Number(item.unitPrice);
      const tolerance = 0.005;
      
      if (!price.rowCount || Math.abs(serverPrice - clientPrice) > tolerance) {
        logger.warn('Price mismatch', { variantId: item.variantId, expected: serverPrice, received: clientPrice });
        throw Object.assign(new Error('Price changed; review the cart'), { statusCode: 409, code: 'PRICE_CHANGED' });
      }

      const lots = await client.query('SELECT lot_id, quantity_on_hand FROM inventory_lots WHERE variant_id=$1 AND quantity_on_hand > 0 ORDER BY expiration_date NULLS LAST, lot_id FOR UPDATE', [item.variantId]);
      let remaining = Number(item.quantity);
      const allocations = item.lotId ? [{ lotId: item.lotId, quantity: remaining }] : [];
      
      if (!allocations.length) {
        for (const lot of lots.rows) { 
          if (remaining <= 0) break; 
          const allocated = Math.min(remaining, Number(lot.quantity_on_hand)); 
          allocations.push({ lotId: lot.lot_id, quantity: allocated }); 
          remaining -= allocated; 
        }
      }
      
      if (remaining > 0) {
        logger.warn('Insufficient inventory', { variantId: item.variantId, requested: item.quantity, available: item.quantity - remaining });
        throw Object.assign(new Error(`Insufficient inventory for ${item.variantId}`), { statusCode: 409, code: 'INSUFFICIENT_INVENTORY' });
      }
      
      for (const [allocationIndex, allocation] of allocations.entries()) { 
        const update = await client.query('UPDATE inventory_lots SET quantity_on_hand=quantity_on_hand-$1, updated_at=now() WHERE lot_id=$2 AND variant_id=$3 AND quantity_on_hand >= $1', [allocation.quantity, allocation.lotId, item.variantId]); 
        if (update.rowCount !== 1) {
          logger.error('Inventory conflict during allocation', { lotId: allocation.lotId, requested: allocation.quantity });
          throw Object.assign(new Error('Inventory changed; retry checkout'), { statusCode: 409, code: 'INVENTORY_CONFLICT' });
        }
        
        await client.query('INSERT INTO order_items (order_item_id, order_id, variant_id, lot_id, quantity, unit_price, total_price) VALUES ($1,$2,$3,$4,$5,$6,$7)', [allocationIndex === 0 ? item.orderItemId : crypto.randomUUID(), validatedPayload.orderId, item.variantId, allocation.lotId, allocation.quantity, item.unitPrice, Number(item.unitPrice) * allocation.quantity]); 
      }
    }
  }
    
    await client.query('COMMIT');
    logger.info('Order created successfully', { orderId: validatedPayload.orderId, itemCount: validatedPayload.items.length });
    return response.status(201).json({ orderId: validatedPayload.orderId, synced: true });
  } catch (error) { 
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('Order creation failed', { error: error.message, orderId: payload.orderId });
    next(error); 
  } finally { 
    client.release(); 
  }
});

// GET Active Reservations
app.get('/api/v1/reservations', auth.requireSession, async(_request, response, next) => {
  try {
    const result = await pool.query(
    `SELECT o.order_id AS "orderId", o.created_at AS "createdSoldAt", o.fulfillment_date AS "fulfillmentDate", 
    COALESCE(c.company_name || ' - ', '') || COALESCE(c.contact_name, 'Walk-in') AS "customerName",
    COALESCE(u.display_name, u.username, 'System') AS "cashierName",
    o.total_amount AS "totalAmount",
    COALESCE(o.deposit_amount, 0) AS "depositAmount",
    COALESCE(o.balance_due, 0) AS "balanceDue",
    COALESCE(o.reservation_status, 'unpaid') AS "reservationStatus",
    o.payment_method AS "paymentMethod",
    oi.order_item_id AS "orderItemId",
    v.variant_id AS "variantId",
    v.sku,
    v.variant_name AS "itemName",
    oi.quantity, oi.unit_price AS "unitPrice", oi.total_price AS "amount"
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    JOIN product_variants v ON v.variant_id = oi.variant_id
    LEFT JOIN customers c ON c.customer_id = o.customer_id
    LEFT JOIN app_users u ON u.user_id = o.employee_id
    WHERE o.order_mode = 'reservation' AND o.status = 'open'
    ORDER BY o.fulfillment_date ASC, o.created_at ASC` );

    const map = new Map();
    for (const row of result.rows) {
      if (!map.has(row.orderId)) {
        map.set(row.orderId, {
          orderId: row.orderId,
          createdSoldAt: row.createdSoldAt,
          fulfillmentDate: row.fulfillmentDate ? new
            Date(row.fulfillmentDate).toISOString().slice(0, 10) : '',
          customerName: row.customerName,
          cashierName: row.cashierName,
          totalAmount: Number(row.totalAmount) || 0,
          depositAmount: Number(row.depositAmount) || 0,
          balanceDue: Number(row.balanceDue) || 0,
          reservationStatus: row.reservationStatus,
          paymentMethod: row.paymentMethod,
          items: [],
        });
      }

      const res = map.get(row.orderId);
      res.items.push({
        orderItemId: row.orderItemId,
        variantId: row.variantId,
        sku: row.sku,
        itemName: row.itemName,
        quantity: Number(row.quantity) || 0,
        unitPrice: Number(row.unitPrice) || 0,
        amount: Number(row.amount) || 0,
      });
    }

    response.json(Array.from(map.values()));
  } catch (error) {
    logger.error('Reservations list failed', { error: error.message });
    next(error);
  }
});

// Fulfill Reservation
app.post('/api/v1/orders/:orderId/fulfill', auth.requireSession, async(request, response, next) => {
  const { orderId } = request.params;
  const payload = request.body ?? {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderCheck = await client.query(
      "SELECT * FROM orders WHERE order_id = $1 AND status = 'open' AND order_mode = 'reservation' FOR UPDATE",
      [orderId]);

    if (!orderCheck.rowCount) {
      throw Object.assign(new Error('Reservation not found or already fulfilled'), { statusCode: 404, code: 'RESERVATION_NOT_FOUND' });
    }
    const order = orderCheck.rows[0];
    const items = await client.query(
      'SELECT order_item_id, variant_id, quantity, unit_price FROM order_items WHERE order_id = $1',
      [orderId]
    );

    for (const item of items.rows) {
      const lots = await client.query(
        'SELECT lot_id, quantity_on_hand FROM inventory_lots WHERE variant_id = $1 AND quantity_on_hand > 0 ORDER BY expiration_date NULLS LAST, lot_id FOR UPDATE',
        [item.variant_id]
      );
      let remaining = Number(item.quantity);
      for (const lot of lots.rows) {
        if (remaining < 0) break;
        const allocated = Math.min(remaining, Number(lot.quantity_on_hand));
        const update = await client.query(
          'UPDATE inventory_lots SET quantity_on_hand = quantity_on_hand - $1, updated_at = now() WHERE lot_id = $2 AND variant_id = $3 AND quantity_on_hand >= $1',
          [allocated, lot.lot_id, item.variant_id]
        );
        if (update.rowCount !== 1) {
          throw Object.assign(new Error('Inventory conflict during fulfillment'), { statusCode: 409, code: 'INVENTORY_CONFLICT' });
        } remaining -= allocated;
      }
      if (remaining > 0) {
        throw Object.assign(new Error(`Insufficient inventory to fulfill reservation for variant ${item.variant_id}`), { statusCode: 409, code: 'INSUFFICIENT_INVENTORY' });
      }
    }

    const newCashReceived = Number(payload.cashReceived || 0) + Number(order.cash_received || 0);
    let updatedPayments = [];
    if (order.payments) {
      try { updatedPayments = typeof order.payments === 'string' ? JSON.parse(order.payments) : order.payments; } catch { }
    }
    if (Array.isArray(payload.payments) && payload.payments.length > 0) {
      updatedPayments.push(...payload.payments);
    } else if (payload.paymentMethod) {
      updatedPayments.push({ method: payload.paymentMethod, amount: Number(order.balance_due) || 0 });
    }

    await client.query(
      `UPDATE orders SET status = 'completed', 
      reservation_status = 'completed', 
      balance_due = 0, 
      cash_received = $1, 
      payments = $2, 
      updated_at = now() 
      WHERE order_id = $3`, 
      [newCashReceived, JSON.stringify(updatedPayments), orderId] );

    await client.query('COMMIT'); logger.info('Reservation fulfilled successfully', { orderId }); response.json({ orderId, fulfilled: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined); 
    logger.error('Reservation fulfillment failed', { error: error.message, orderId });
    next(error);
  } finally { client.release(); }
});

// Cancel Reservation
app.post('/api/v1/orders/:orderId/cancel', auth.requireSession, async(request, response, next) => {
  const { orderId } = request.params;
  try {
    const result = await pool.query(
      "UPDATE orders SET status = 'cancelled',reservation_status = 'cancelled',updated_at = now() WHERE order_id = $1 AND status = 'open' RETURNING order_id", 
      [orderId]);

    if (!result.rowCount) {
      return response.status(404).json({ error: 'RESERVATION_NOT_FOUND', message: 'Reservation not found or already completed/cancelled' });
    }
    
    response.json({ orderId, cancelled: true });
  } catch (error) {
    logger.error('Reservation cancellation failed', { error: error.message, orderId });
    next(error);
  }
});

// Sales Report Endpoint
app.get('/api/v1/sales/report', auth.requireSession, async (request, response, next) => {
  try {
    const rawDate = String(request.query.date ?? '').trim();
    const match = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
    const date = match ? match[1] : new Date().toISOString().slice(0, 10);

    const start = `${date}T00:00:00+08:00`;
    const result = await pool.query(
    `SELECT oi.order_item_id AS "orderItemId", v.variant_id AS "variantId", oi.lot_id AS "lotId", oi.unit_price AS "unitPrice", COALESCE(oi.returned_quantity, 0) AS "returnedQuantity", o.order_id AS "orderId", o.created_at AS "soldAt", COALESCE(c.company_name || ' - ', '') || COALESCE(c.contact_name, 'Walk-in') AS "customerName", COALESCE(u.display_name, u.username, 'System') AS "cashierName", v.sku, v.variant_name AS "itemName", oi.quantity, oi.total_price AS amount, o.payment_method AS "paymentMethod", o.cash_received AS "cashReceived", o.change_due AS "changeDue", o.total_amount AS "totalAmount", COALESCE(p.initial_cost, 0) AS "initialCost", o.order_type AS "orderType", 
    o.payments AS "payments"
       FROM order_items oi 
       JOIN orders o ON o.order_id=oi.order_id 
       JOIN product_variants v ON v.variant_id=oi.variant_id 
       JOIN products p ON p.product_id=v.product_id 
       LEFT JOIN customers c ON c.customer_id=o.customer_id 
       LEFT JOIN app_users u ON u.user_id=o.employee_id 
       WHERE o.status='completed' AND o.created_at >= $1::timestamptz AND o.created_at < ($1::timestamptz + interval '1 day') 
       ORDER BY o.created_at DESC, o.order_id, oi.order_item_id`, 
      [start]
    );
    
    const items = result.rows.map((row) => ({ 
      ...row, 
      quantity: Number(row.quantity) || 0, 
      returnedQuantity: Number(row.returnedQuantity) || 0,
      amount: Number(row.amount) || 0,
      unitPrice: Number(row.unitPrice) || 0,
      payments: row.payments ? (typeof row.payments === 'string' ? JSON.parse(row.payments) : row.payments) : undefined
    }));
    
    const summary = async (periodStart, periodEnd) => {
      const period = await pool.query(`SELECT COALESCE(SUM(total_amount), 0)::numeric AS gross, COUNT(order_id)::int AS orders FROM orders WHERE status='completed' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz`, [periodStart, periodEnd]);
      return { grossTotal: Number(period.rows[0].gross) || 0, netTotal: Number(period.rows[0].gross) || 0, orderCount: period.rows[0].orders };
    };
    
    const selected = new Date(`${date}T00:00:00Z`);
    const monday = new Date(selected);
    const day = monday.getUTCDay();
    monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1));
    
    const nextMonth = new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth() + 1, 1));
    const nextYear = new Date(Date.UTC(selected.getUTCFullYear() + 1, 0, 1));
    
    const dateString = (value) => value.toISOString().slice(0, 10);
    const periodBounds = (startDate, endDate) => [`${startDate}T00:00:00+08:00`, `${endDate}T00:00:00+08:00`];
    
    const weekStart = dateString(monday);
    const weekEnd = dateString(new Date(monday.getTime() + 7 * 86400000));
    const monthStart = `${selected.getUTCFullYear()}-${String(selected.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const yearStart = `${selected.getUTCFullYear()}-01-01`;
    
    const [week, month, year] = request.user.role === 'admin' 
      ? await Promise.all([
          summary(...periodBounds(weekStart, weekEnd)), 
          summary(...periodBounds(monthStart, dateString(nextMonth))), 
          summary(...periodBounds(yearStart, dateString(nextYear)))
        ]) 
      : [null, null, null];
    
    response.json({ 
      selectedDate: date, 
      items, 
      dayGrossTotal: items.reduce((total, item) => total + item.amount, 0), 
      dayNetTotal: items.reduce((total, item) => total + item.amount, 0), 
      dayOrderCount: new Set(items.map((item) => item.orderId)).size, 
      week: week && { ...week, startDate: weekStart, endDate: weekEnd }, 
      month: month && { ...month, startDate: monthStart, endDate: dateString(nextMonth) }, 
      year: year && { ...year, startDate: yearStart, endDate: dateString(nextYear) }, 
      timezone: 'Asia/Manila' 
    });
  } catch (error) { 
    logger.error('Sales report failed', { error: error.message });
    next(error); 
  }
});


// Monthly Sales & Financial Aggregation Endpoint (Actual COGS & 12-Month Performance)
app.get('/api/v1/sales/monthly', auth.requireSession, async (request, response, next) => {
  try {
    const rawYear = String(request.query.year ?? '').trim();
    const yearMatch = rawYear.match(/^(\d{4})/);
    const targetYear = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

    const yearStart = `${targetYear}-01-01T00:00:00+08:00`;

    const result = await pool.query(
      `SELECT 
         EXTRACT(MONTH FROM o.created_at AT TIME ZONE 'Asia/Manila')::int AS "month",
         o.order_id AS "orderId",
         o.total_amount AS "totalAmount",
         o.payment_method AS "paymentMethod",
         o.payments AS "payments",
         COALESCE(SUM(oi.total_price), 0)::numeric AS "grossSales",
         COALESCE(SUM(oi.quantity * COALESCE(p.initial_cost, 0)), 0)::numeric AS "cogs",
         COALESCE(SUM(oi.quantity), 0)::numeric AS "itemsSold"
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.order_id
       JOIN product_variants v ON v.variant_id = oi.variant_id
       JOIN products p ON p.product_id = v.product_id
       WHERE o.status = 'completed'
         AND o.created_at >= $1::timestamptz
         AND o.created_at < ($1::timestamptz + interval '1 year')
       GROUP BY EXTRACT(MONTH FROM o.created_at AT TIME ZONE 'Asia/Manila'), o.order_id, o.total_amount, o.payment_method, o.payments
       ORDER BY "month" ASC`,
      [yearStart]
    );

    const monthlyMap = new Map();
    for (let m = 1; m <= 12; m++) {
      monthlyMap.set(m, { month: m, grossSales: 0, cogs: 0, orderIds: new Set(), itemsSold: 0, cashSales: 0, gcashSales: 0, cardSales: 0, accountSales: 0 });
    }

    for (const row of result.rows) {
      const m = Number(row.month);
      const entry = monthlyMap.get(m);
      if (!entry) continue;

      const gross = Number(row.grossSales) || 0;
      const cogs = Number(row.cogs) || 0;
      const items = Number(row.itemsSold) || 0;

      entry.grossSales += gross;
      entry.cogs += cogs;
      entry.itemsSold += items;

      if (!entry.orderIds.has(row.orderId)) {
        entry.orderIds.add(row.orderId);
        const method = String(row.paymentMethod || 'cash').toLowerCase().trim();
        let parsedPayments = row.payments;
        if (typeof parsedPayments === 'string') {
          try { parsedPayments = JSON.parse(parsedPayments); } catch { parsedPayments = null; }
        }

        if (method === 'split' && Array.isArray(parsedPayments) && parsedPayments.length > 0) {
          for (const p of parsedPayments) {
            const pm = String(p.method || '').toLowerCase().trim();
            const amt = Number(p.amount) || 0;
            if (pm.includes('gcash')) entry.gcashSales += amt;
            else if (pm.includes('card')) entry.cardSales += amt;
            else if (pm.includes('account')) entry.accountSales += amt;
            else if (pm.includes('cash')) entry.cashSales += amt;
          }
        } else {
          const totalAmt = Number(row.totalAmount) || gross;
          if (method.includes('gcash')) entry.gcashSales += totalAmt;
          else if (method.includes('card')) entry.cardSales += totalAmt;
          else if (method.includes('account')) entry.accountSales += totalAmt; 
          else if (method.includes('cash')) entry.cashSales += totalAmt;
        }
      }
    }
    const months = Array.from(monthlyMap.values()).map((entry) => { 
      const gross = entry.grossSales;
      const cogs = entry.cogs;
      const grossProfit = gross - cogs;
      const profitMarginPct = gross > 0 ? (grossProfit / gross) * 100 : 0;
      const orderCount = entry.orderIds.size;
      const aov = orderCount > 0 ? gross / orderCount : 0;
      const avgUnitsPerOrder = orderCount > 0 ? entry.itemsSold / orderCount : 0;

      return {  
        month: entry.month,
        grossSales: Number(gross.toFixed(2)),
        cogs: Number(cogs.toFixed(2)),
        grossProfit: Number(grossProfit.toFixed(2)),
        profitMarginPct: Number(profitMarginPct.toFixed(1)),
        orderCount,
        itemsSold: Number(entry.itemsSold.toFixed(4)),
        aov: Number(aov.toFixed(2)),
        avgUnitsPerOrder: Number(avgUnitsPerOrder.toFixed(2)),
        cashSales: Number(entry.cashSales.toFixed(2)),
        gcashSales: Number(entry.gcashSales.toFixed(2)),
        cardSales: Number(entry.cardSales.toFixed(2)),
        accountSales: Number(entry.accountSales.toFixed(2)),
        estimatedCardFees: Number((entry.cardSales * 0.025).toFixed(2)),
  };
});

    response.json({
      year: targetYear,
      months
    });
  } catch (error) {
    logger.error('Monthly sales report failed', { error: error.message });
    next(error);
  }
});

// Global error handler
app.use((error, _request, response, _next) => {
  const statusCode = error.statusCode || (error.code ? 400 : 500);
  const code = error.code || 'INTERNAL_ERROR';
  const message = error.message || 'An unexpected error occurred';
  
  logger.error('Request error', { 
    statusCode, 
    code, 
    message,
    stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
  });
  
  response.status(statusCode).json({ 
    error: code, 
    message: process.env.NODE_ENV === 'production' ? undefined : message 
  }); 
});


// Automatically closes forgotten overnight shifts at 23:59:59 Manila time
async function autoCloseOvernightShifts() {
  try {
    await pool.query(`
      UPDATE employee_shifts
      SET clock_out = ((clock_in AT TIME ZONE 'Asia/Manila')::date + time '23:59:59') AT TIME ZONE 'Asia/Manila',
          status = 'AUTO_CLOSED',
          notes = COALESCE(notes, 'Auto-closed at midnight; pending manager audit')
      WHERE clock_out IS NULL 
        AND (clock_in AT TIME ZONE 'Asia/Manila')::date < (now() AT TIME ZONE 'Asia/Manila')::date
    `);
  } catch (error) {
    logger.warn('Overnight shift auto-close check failed:', { error: error.message });
  }
}

async function ensureShiftColumns() {
  try {
    await pool.query(`
      ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS opening_float NUMERIC(12,2) DEFAULT 1500.00;
      ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS closing_cash_count NUMERIC(12,2);
      ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS expected_cash NUMERIC(12,2);
      ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS cash_discrepancy NUMERIC(12,2);
      ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'OPEN';
      ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payments JSONB;
    `);
    logger.info('Employee shift audit and split payment schema ensured');
  } catch (error) {
    logger.error('Failed to ensure employee shift audit columns', { error: error.message });
  }
}

async function start(port = Number(process.env.PORT ?? 3000)) { 
  try {
    logger.info('Running database migration...');
    await migrate(); 
    await ensureShiftColumns(); 
    logger.info('Migration complete, starting server...');
    
    return new Promise((resolve, reject) => {
      const server = app.listen(port, () => {
        logger.info(`Bake Alley cloud API listening on port ${port}`);
        resolve(server);
      });
      
      server.on('error', (error) => {
        logger.error('Server error', { error: error.message, code: error.code });
        reject(error);
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message, code: error.code, stack: error.stack });
    throw error;
  }
}

if (require.main === module) {
  logger.info('Starting Bake Alley Cloud API...');
  start().catch((error) => { 
    logger.error('Fatal startup error', { 
      error: error.message, 
      code: error.code, 
      stack: error.stack 
    });
    process.exitCode = 1; 
  });
}

module.exports = { app, start };