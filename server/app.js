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
    const result = await pool.query('SELECT customer_id AS "customerId", COALESCE(company_name || \' - \', \'\') || contact_name AS "displayName", email, phone, tier_id AS "tierId" FROM customers ORDER BY contact_name'); 
    response.json(result.rows); 
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
    response.status(201).json(result.rows[0]);
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
    if (!variantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$/i.test(variantId)) {
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
       WHERE ($1 = 'admin' OR u.user_id = $2) 
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
    const result = await pool.query(
      `INSERT INTO employee_shifts (shift_id, user_id, clock_in) 
       SELECT gen_random_uuid(), $1, now() 
       WHERE NOT EXISTS (SELECT 1 FROM employee_shifts WHERE user_id = $1 AND clock_out IS NULL) 
       RETURNING shift_id AS "shiftId", user_id AS "userId", clock_in AS "clockIn"`, 
      [request.user.userId]
    );
    if (!result.rowCount) {
      logger.warn('Clock-in failed - shift already open', { userId: request.user.userId });
      return response.status(409).json({ error: 'SHIFT_ALREADY_OPEN' });
    }
    logger.info('Employee clocked in', { userId: request.user.userId });
    response.status(201).json(result.rows[0]);
  } catch (error) { 
    logger.error('Clock-in failed', { error: error.message });
    next(error); 
  }
});

app.post('/api/v1/employees/clock-out', auth.requireSession, async (request, response, next) => {
  try {
    const result = await pool.query(
      `UPDATE employee_shifts SET clock_out = now() WHERE user_id = $1 AND clock_out IS NULL 
       RETURNING shift_id AS "shiftId", user_id AS "userId", clock_in AS "clockIn", clock_out AS "clockOut"`, 
      [request.user.userId]
    );
    if (!result.rowCount) {
      logger.warn('Clock-out failed - no open shift', { userId: request.user.userId });
      return response.status(409).json({ error: 'NO_OPEN_SHIFT' });
    }
    logger.info('Employee clocked out', { userId: request.user.userId });
    response.json(result.rows[0]);
  } catch (error) { 
    logger.error('Clock-out failed', { error: error.message });
    next(error); 
  }
});

app.delete('/api/v1/employees/:userId', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  try {
    const { userId } = request.params;
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$/i.test(userId)) {
      return response.status(400).json({ error: 'INVALID_USER_ID', message: 'User ID must be a valid UUID' });
    }

    const userCheck = await pool.query('SELECT user_id, username FROM app_users WHERE user_id=\$1', [userId]);
    if (!userCheck.rowCount) {
      return response.status(404).json({ error: 'USER_NOT_FOUND', message: 'Employee not found' });
    }

    const orderCheck = await pool.query('SELECT COUNT(*)::int as count FROM orders WHERE employee_id=\$1', [userId]);
    if (Number(orderCheck.rows[0].count) > 0) {
      logger.warn('Employee deletion blocked - has orders', { userId, orderCount: orderCheck.rows[0].count });
      return response.status(409).json({ error: 'EMPLOYEE_HAS_ORDERS', message: `Cannot delete employee with ${orderCheck.rows[0].count} associated orders` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM employee_shifts WHERE user_id=\$1', [userId]);
      await client.query('DELETE FROM app_users WHERE user_id=\$1', [userId]);
      await client.query('COMMIT');
      logger.info('Employee deleted', { userId, username: userCheck.rows[0].username });
      response.status(200).json({ message: 'Employee deleted successfully' });
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

// Employee Shifts List Endpoint (Strict YYYY-MM-DD Date Filter)
app.get('/api/v1/employees/shifts', auth.requireSession, async (request, response, next) => {
  try {
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
      `SELECT s.shift_id AS "shiftId", s.user_id AS "userId", u.display_name AS "displayName", u.role AS "role", s.clock_in AS "clockIn", s.clock_out AS "clockOut" 
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Calculate changeDue server-side
    const changeDue = validatedPayload.paymentMethod === 'cash' 
      ? Math.max(0, Number(validatedPayload.cashReceived || 0) - Number(validatedPayload.totalAmount))
      : 0;
    
    const inserted = await client.query(
      `INSERT INTO orders (order_id, customer_id, pricing_tier_id, employee_id, order_type, status, subtotal, tax_amount, total_amount, payment_method, cash_received, change_due, created_at) 
       VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$8,$9,$10,$11,$12) 
       ON CONFLICT (order_id) DO NOTHING RETURNING order_id`, 
      [
        validatedPayload.orderId, 
        validatedPayload.customerId ?? null, 
        validatedPayload.pricingTierId, 
        request.user.userId, 
        validatedPayload.orderType === 'commercial' ? 'commercial' : 'retail', 
        validatedPayload.subtotal, 
        validatedPayload.taxAmount ?? 0, 
        validatedPayload.totalAmount, 
        validatedPayload.paymentMethod, 
        validatedPayload.cashReceived ?? 0, 
        changeDue,
        validatedPayload.createdAt ?? new Date().toISOString()
      ]
    );
    
    if (inserted.rowCount === 0) { 
      await client.query('COMMIT');
      logger.info('Order is duplicate (idempotent)', { orderId: validatedPayload.orderId });
      return response.json({ orderId: validatedPayload.orderId, duplicate: true }); 
    }
    
    if (validatedPayload.paymentMethod === 'cash' && Number(validatedPayload.cashReceived || 0) < Number(validatedPayload.totalAmount)) {
      throw Object.assign(new Error('Cash received must be at least the order total'), { statusCode: 400, code: 'INSUFFICIENT_CASH' });
    }

    for (const item of validatedPayload.items) {
      let price = await client.query(
        'SELECT pp.price_per_unit FROM product_prices pp WHERE pp.variant_id=\$1 AND pp.tier_id=\$2 AND pp.min_quantity <= \$3 ORDER BY pp.min_quantity DESC LIMIT 1', 
        [item.variantId, validatedPayload.pricingTierId, item.quantity]
      );

      if (!price.rowCount) {
        price = await client.query(
          'SELECT pp.price_per_unit FROM product_prices pp WHERE pp.variant_id=\$1 AND pp.price_per_unit > 0 ORDER BY pp.min_quantity ASC LIMIT 1',
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

      const lots = await client.query('SELECT lot_id, quantity_on_hand FROM inventory_lots WHERE variant_id=\$1 AND quantity_on_hand > 0 ORDER BY expiration_date NULLS LAST, lot_id FOR UPDATE', [item.variantId]);
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
        const update = await client.query('UPDATE inventory_lots SET quantity_on_hand=quantity_on_hand-\$1, updated_at=now() WHERE lot_id=\$2 AND variant_id=\$3 AND quantity_on_hand >= \$1', [allocation.quantity, allocation.lotId, item.variantId]); 
        if (update.rowCount !== 1) {
          logger.error('Inventory conflict during allocation', { lotId: allocation.lotId, requested: allocation.quantity });
          throw Object.assign(new Error('Inventory changed; retry checkout'), { statusCode: 409, code: 'INVENTORY_CONFLICT' });
        }
        
        await client.query('INSERT INTO order_items (order_item_id, order_id, variant_id, lot_id, quantity, unit_price, total_price) VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7)', [allocationIndex === 0 ? item.orderItemId : crypto.randomUUID(), validatedPayload.orderId, item.variantId, allocation.lotId, allocation.quantity, item.unitPrice, Number(item.unitPrice) * allocation.quantity]); 
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

// Sales Report Endpoint
app.get('/api/v1/sales/report', auth.requireSession, async (request, response, next) => {
  try {
    const rawDate = String(request.query.date ?? '').trim();
    const match = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
    const date = match ? match[1] : new Date().toISOString().slice(0, 10);

    const start = `${date}T00:00:00+08:00`;
    const result = await pool.query(
      `SELECT o.order_id AS "orderId", o.created_at AS "soldAt", COALESCE(c.company_name || ' - ', '') || COALESCE(c.contact_name, 'Walk-in') AS "customerName", v.sku, v.variant_name AS "itemName", oi.quantity, oi.total_price AS amount, o.payment_method AS "paymentMethod", o.cash_received AS "cashReceived", o.change_due AS "changeDue", o.total_amount AS "totalAmount" 
       FROM order_items oi 
       JOIN orders o ON o.order_id=oi.order_id 
       JOIN product_variants v ON v.variant_id=oi.variant_id 
       LEFT JOIN customers c ON c.customer_id=o.customer_id 
       WHERE o.status='completed' AND o.created_at >= $1::timestamptz AND o.created_at < ($1::timestamptz + interval '1 day') 
       ORDER BY o.created_at DESC, o.order_id, oi.order_item_id`, 
      [start]
    );
    
    const items = result.rows.map((row) => ({ 
      ...row, 
      quantity: Number(row.quantity) || 0, 
      amount: Number(row.amount) || 0,
      cashReceived: Number(row.cashReceived) || 0,
      changeDue: Number(row.changeDue) || 0,
      totalAmount: Number(row.totalAmount) || 0
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

async function start(port = Number(process.env.PORT ?? 3000)) { 
  try {
    logger.info('Running database migration...');
    await migrate(); 
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