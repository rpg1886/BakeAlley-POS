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

    if (q) {
      params.push(`%${q}%`);
      whereConditions.push(`(v.sku ILIKE $${params.length} OR v.barcode ILIKE $${params.length} OR v.variant_name ILIKE $${params.length} OR p.name ILIKE $${params.length})`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT v.variant_id AS "variantId", v.sku, v.variant_name AS name, u.symbol AS unit, p.is_sold_by_weight AS "soldByWeight",
              p.category_id AS "categoryId", c.name AS "categoryName",
              pp.tier_id AS "tierId", pp.min_quantity AS "minQuantity", pp.price_per_unit AS "pricePerUnit"
       FROM product_variants v
       JOIN products p ON p.product_id = v.product_id
       LEFT JOIN categories c ON c.category_id = p.category_id
       JOIN units_of_measure u ON u.uom_id = p.base_uom_id
       LEFT JOIN product_prices pp ON pp.variant_id = v.variant_id
       ${whereClause}
       ORDER BY v.variant_name LIMIT 100`,
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
          prices: [],
        });
      }
      if (row.tierId) {
        grouped.get(row.variantId).prices.push({
          tierId: row.tierId,
          minQuantity: Number(row.minQuantity),
          pricePerUnit: Number(row.pricePerUnit),
        });
      }
    }

    response.json([...grouped.values()]);
  } catch (error) {
    logger.error('Product search failed', { error: error.message });
    next(error);
  }
});

// Single Product Details Endpoint
app.get('/api/v1/products/:variantId', auth.requireSession, async (request, response, next) => {
  try {
    const { variantId } = request.params;
    const result = await pool.query(
      `SELECT v.variant_id AS "variantId", v.sku, v.variant_name AS "variantName",
              p.product_id AS "productId", p.name AS "productName", p.base_uom_id AS "baseUomId",
              p.is_sold_by_weight AS "soldByWeight", p.requires_lot_tracking AS "requiresLotTracking",
              p.initial_cost AS "initialCost",
              COALESCE(SUM(l.quantity_on_hand), 0) AS "quantityOnHand",
              MIN(l.expiration_date) AS "expirationDate",
              MIN(l.lot_number) AS "lotNumber"
       FROM product_variants v
       JOIN products p ON p.product_id = v.product_id
       LEFT JOIN inventory_lots l ON l.variant_id = v.variant_id
       WHERE v.variant_id = $1
       GROUP BY v.variant_id, v.sku, v.variant_name, p.product_id, p.name, p.base_uom_id, p.is_sold_by_weight, p.requires_lot_tracking, p.initial_cost`,
      [variantId]
    );

    if (!result.rowCount) {
      return response.status(404).json({ error: 'PRODUCT_NOT_FOUND' });
    }

    const pricesResult = await pool.query(
      `SELECT pp.tier_id AS "tierId", pt.tier_name AS "tierName", pp.min_quantity AS "minQuantity", pp.price_per_unit AS "pricePerUnit"
       FROM product_prices pp
       JOIN price_tiers pt ON pt.tier_id = pp.tier_id
       WHERE pp.variant_id = $1 ORDER BY pp.min_quantity`,
      [variantId]
    );

    const row = result.rows[0];
    response.json({
      ...row,
      quantityOnHand: Number(row.quantityOnHand) || 0,
      initialCost: Number(row.initialCost) || 0,
      prices: pricesResult.rows.map(pr => ({ ...pr, minQuantity: Number(pr.minQuantity), pricePerUnit: Number(pr.pricePerUnit) }))
    });
  } catch (error) {
    logger.error('Product details fetch failed', { error: error.message });
    next(error);
  }
});

// Customers Endpoints
app.get('/api/v1/customers', auth.requireSession, async (_request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT customer_id AS "customerId", COALESCE(company_name || ' - ', '') || contact_name AS "displayName", email, phone, tier_id AS "tierId"
       FROM customers ORDER BY contact_name`
    );
    response.json(result.rows);
  } catch (error) {
    logger.error('Customers list failed', { error: error.message });
    next(error);
  }
});

app.post('/api/v1/customers', auth.requireSession, async (request, response, next) => {
  try {
    const validation = validate(customerSchema, request.body);
    if (!validation.success) {
      logger.warn('Customer creation validation failed', { errors: validation.errors });
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
    const { id } = request.params;
    const protectedCustomer = await pool.query('SELECT 1 FROM orders WHERE customer_id = $1 LIMIT 1', [id]);
    if (protectedCustomer.rowCount) {
      logger.warn('Customer deletion blocked - has orders', { customerId: id });
      return response.status(409).json({ error: 'CUSTOMER_HAS_ORDERS' });
    }

    const result = await pool.query('DELETE FROM customers WHERE customer_id = $1', [id]);
    if (!result.rowCount) {
      return response.status(404).json({ error: 'CUSTOMER_NOT_FOUND' });
    }

    logger.info('Customer deleted', { customerId: id });
    response.status(204).end();
  } catch (error) {
    logger.error('Customer deletion failed', { error: error.message });
    next(error);
  }
});

// Inventory List Endpoint
app.get('/api/v1/inventory', auth.requireSession, async (_request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT v.variant_id AS "variantId", v.sku, v.variant_name AS "variantName",
              p.name AS "productName", p.category_id AS "categoryId", c.name AS "categoryName",
              COALESCE(SUM(l.quantity_on_hand), 0) AS "quantityOnHand",
              MIN(l.expiration_date) AS "expirationDate",
              COALESCE(p.initial_cost, 0) AS "initialCapital",
              COALESCE((SELECT pp.price_per_unit FROM product_prices pp JOIN price_tiers pt ON pt.tier_id=pp.tier_id WHERE pp.variant_id=v.variant_id AND lower(pt.tier_name)='retail' ORDER BY pp.min_quantity LIMIT 1), 0) AS "retailPrice"
       FROM product_variants v
       JOIN products p ON p.product_id=v.product_id
       LEFT JOIN categories c ON c.category_id=p.category_id
       LEFT JOIN inventory_lots l ON l.variant_id=v.variant_id
       GROUP BY v.variant_id, v.sku, v.variant_name, p.name, p.category_id, c.name, p.initial_cost
       ORDER BY v.variant_name`
    );
    response.json(result.rows.map((row) => ({
      ...row,
      quantityOnHand: Number(row.quantityOnHand) || 0,
      initialCapital: Number(row.initialCapital) || 0,
      retailPrice: Number(row.retailPrice) || 0,
    })));
  } catch (error) {
    logger.error('Inventory list failed', { error: error.message });
    next(error);
  }
});

app.post('/api/v1/inventory/adjust', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  const validation = validate(inventoryAdjustSchema, request.body);
  if (!validation.success) {
    logger.warn('Inventory adjustment validation failed', { errors: validation.errors });
    return response.status(400).json({ error: 'INVALID_INVENTORY_ADJUSTMENT', details: validation.errors });
  }

  const body = validation.data;
  const quantity = Number(body.quantity);
  const price = body.retailPrice === undefined || body.retailPrice === '' ? undefined : Number(body.retailPrice);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const variant = await client.query('SELECT variant_id FROM product_variants WHERE variant_id=$1 FOR UPDATE', [body.variantId]);
    if (!variant.rowCount) {
      throw Object.assign(new Error('Variant not found'), { statusCode: 404, code: 'VARIANT_NOT_FOUND' });
    }

    const lotNumber = body.lotNumber || `CLOUD-${body.variantId.slice(0, 8)}-${body.expirationDate || 'NOEXPIRY'}`;
    await client.query(
      `INSERT INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       ON CONFLICT (variant_id, lot_number) DO UPDATE
       SET expiration_date=EXCLUDED.expiration_date, quantity_on_hand=EXCLUDED.quantity_on_hand, updated_at=now()`,
      [body.variantId, lotNumber, body.expirationDate || null, quantity]
    );

    if (price !== undefined) {
      const retailTier = await client.query("SELECT tier_id FROM price_tiers WHERE lower(tier_name)='retail' LIMIT 1");
      if (!retailTier.rowCount) {
        throw Object.assign(new Error('Retail tier is not configured'), { statusCode: 409, code: 'RETAIL_TIER_NOT_FOUND' });
      }
      await client.query(
        `INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity)
         VALUES (gen_random_uuid(), $1, $2, $3, 0)
         ON CONFLICT (variant_id, tier_id, min_quantity) DO UPDATE
         SET price_per_unit=EXCLUDED.price_per_unit`,
        [body.variantId, retailTier.rows[0].tier_id, price]
      );
    }

    await client.query('COMMIT');
    logger.info('Inventory adjusted', { variantId: body.variantId, quantity, price });
    response.status(200).json({ updated: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('Inventory adjustment failed', { error: error.message });
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/v1/inventory/products', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  const validation = validate(inventoryProductSchema, request.body);
  if (!validation.success) {
    logger.warn('Product inventory creation validation failed', { errors: validation.errors });
    return response.status(400).json({ error: 'INVALID_PRODUCT_INVENTORY', details: validation.errors });
  }

  const body = validation.data;
  const quantity = Number(body.quantity);
  const price = Number(body.retailPrice);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const retailTier = await client.query("SELECT tier_id FROM price_tiers WHERE lower(tier_name)='retail' LIMIT 1");
    if (!retailTier.rowCount) {
      throw Object.assign(new Error('Retail tier is not configured'), { statusCode: 409, code: 'RETAIL_TIER_NOT_FOUND' });
    }

    const product = await client.query(
      `INSERT INTO products (product_id, category_id, name, base_uom_id, is_sold_by_weight, requires_lot_tracking, initial_cost)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) RETURNING product_id`,
      [body.categoryId || null, body.name, body.baseUomId, Boolean(body.soldByWeight), Boolean(body.requiresLotTracking), Number(body.initialCost) || 0]
    );

    const variant = await client.query(
      `INSERT INTO product_variants (variant_id, product_id, sku, barcode, variant_name)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       RETURNING variant_id AS "variantId", sku, variant_name AS "variantName"`,
      [product.rows[0].product_id, body.sku, body.barcode || null, body.variantName]
    );

    await client.query(
      `INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity)
       VALUES (gen_random_uuid(), $1, $2, $3, 0)`,
      [variant.rows[0].variantId, retailTier.rows[0].tier_id, price]
    );

    await client.query(
      `INSERT INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [variant.rows[0].variantId, body.lotNumber, body.expirationDate || null, quantity]
    );

    await client.query('COMMIT');
    logger.info('Product inventory created', { variantId: variant.rows[0].variantId, sku: body.sku });
    response.status(201).json(variant.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('Product inventory creation failed', { error: error.message });
    next(error);
  } finally {
    client.release();
  }
});

// Update Existing Product Endpoint
app.put('/api/v1/inventory/products/:variantId', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  const validation = validate(inventoryUpdateSchema, request.body);
  if (!validation.success) {
    logger.warn('Product inventory update validation failed', { errors: validation.errors });
    return response.status(400).json({ error: 'INVALID_PRODUCT_UPDATE', details: validation.errors });
  }

  const { variantId } = request.params;
  const body = validation.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const variantCheck = await client.query(
      'SELECT v.variant_id, v.product_id FROM product_variants v WHERE v.variant_id = $1 FOR UPDATE',
      [variantId]
    );
    if (!variantCheck.rowCount) {
      throw Object.assign(new Error('Variant not found'), { statusCode: 404, code: 'VARIANT_NOT_FOUND' });
    }
    const productId = variantCheck.rows[0].product_id;

    if (body.variantName || body.sku) {
      await client.query(
        `UPDATE product_variants 
         SET variant_name = COALESCE($1, variant_name),
             sku = COALESCE($2, sku)
         WHERE variant_id = $3`,
        [body.variantName || null, body.sku || null, variantId]
      );
      if (body.variantName) {
        await client.query('UPDATE products SET name = $1, updated_at = now() WHERE product_id = $2', [body.variantName, productId]);
      }
    }

    if (body.initialCost !== undefined) {
      await client.query('UPDATE products SET initial_cost = $1, updated_at = now() WHERE product_id = $2', [Number(body.initialCost), productId]);
    }

    if (body.retailPrice !== undefined) {
      const retailTier = await client.query("SELECT tier_id FROM price_tiers WHERE lower(tier_name)='retail' LIMIT 1");
      if (retailTier.rowCount) {
        await client.query(
          `INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity)
           VALUES (gen_random_uuid(), $1, $2, $3, 0)
           ON CONFLICT (variant_id, tier_id, min_quantity) DO UPDATE
           SET price_per_unit = EXCLUDED.price_per_unit`,
          [variantId, retailTier.rows[0].tier_id, Number(body.retailPrice)]
        );
      }
    }

    if (body.quantity !== undefined && body.quantity !== null) {
      const lotNumber = body.lotNumber || `CLOUD-${variantId.slice(0, 8)}-${body.expirationDate || 'NOEXPIRY'}`;
      await client.query(
        `INSERT INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         ON CONFLICT (variant_id, lot_number) DO UPDATE
         SET expiration_date = EXCLUDED.expiration_date, quantity_on_hand = EXCLUDED.quantity_on_hand, updated_at = now()`,
        [variantId, lotNumber, body.expirationDate || null, Number(body.quantity)]
      );
    }

    await client.query('COMMIT');
    logger.info('Product inventory updated', { variantId });
    response.status(200).json({ updated: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('Product inventory update failed', { error: error.message });
    next(error);
  } finally {
    client.release();
  }
});

// Employee Roster List Endpoint (Filters Active Employees)
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

// Create/Reactivate Employee Endpoint
app.post('/api/v1/employees', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  try {
    const validation = validate(employeeSchema, request.body);
    if (!validation.success) {
      logger.warn('Employee creation validation failed', { errors: validation.errors });
      return response.status(400).json({ error: 'INVALID_EMPLOYEE', details: validation.errors });
    }

    const body = validation.data;
    const username = String(body.username).trim().toLowerCase();

    // Check if account with username already exists (active or inactive)
    const existing = await pool.query('SELECT user_id, active FROM app_users WHERE username = $1', [username]);
    if (existing.rowCount > 0) {
      if (existing.rows[0].active) {
        return response.status(409).json({ error: 'USERNAME_EXISTS', message: 'An active employee with this username already exists' });
      }
      // Reactivate previously soft-deleted employee account
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(String(body.password), salt, 64).toString('hex');
      const reactivated = await pool.query(
        `UPDATE app_users 
         SET display_name = $1, role = $2, password_salt = $3, password_hash = $4, active = TRUE, updated_at = now()
         WHERE user_id = $5
         RETURNING user_id AS "userId", username, display_name AS "displayName", role, active`,
        [body.displayName, body.role, salt, hash, existing.rows[0].user_id]
      );
      logger.info('Employee account reactivated', { userId: reactivated.rows[0].userId, username });
      return response.status(200).json(reactivated.rows[0]);
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(body.password), salt, 64).toString('hex');
    const result = await pool.query(
      `INSERT INTO app_users (user_id, username, display_name, role, password_salt, password_hash)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       RETURNING user_id AS "userId", username, display_name AS "displayName", role, active`,
      [username, body.displayName, body.role, salt, hash]
    );
    logger.info('Employee created', { userId: result.rows[0].userId, username });
    response.status(201).json(result.rows[0]);
  } catch (error) { 
    logger.error('Employee creation failed', { error: error.message });
    next(error); 
  }
});

// Soft Delete Employee Endpoint
app.delete('/api/v1/employees/:userId', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  try {
    const { userId } = request.params;
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return response.status(400).json({ error: 'INVALID_USER_ID', message: 'User ID must be a valid UUID' });
    }

    if (userId === request.user.userId) {
      return response.status(400).json({ error: 'CANNOT_DELETE_SELF', message: 'You cannot delete your own logged-in admin account' });
    }

    const userCheck = await pool.query('SELECT user_id, username FROM app_users WHERE user_id=$1 AND active=TRUE', [userId]);
    if (!userCheck.rowCount) {
      return response.status(404).json({ error: 'USER_NOT_FOUND', message: 'Employee not found or already deactivated' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 1. Soft-delete employee account
      await client.query('UPDATE app_users SET active=FALSE, updated_at=now() WHERE user_id=$1', [userId]);
      // 2. Immediately purge active sessions to revoke access
      await client.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
      await client.query('COMMIT');
      logger.info('Employee deactivated successfully', { userId, username: userCheck.rows[0].username });
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

// Auto-close overnight shifts helper
async function autoCloseOvernightShifts() {
  try {
    await pool.query(
      `UPDATE employee_shifts 
       SET clock_out = clock_in + interval '12 hours', 
           status = 'AUTO_CLOSED',
           notes = COALESCE(notes || ' | ', '') || 'System auto-closed overnight shift after 12 hours'
       WHERE clock_out IS NULL 
         AND clock_in < (NOW() AT TIME ZONE 'Asia/Manila' - interval '14 hours')`
    );
  } catch (error) {
    logger.error('Failed to auto-close overnight shifts', { error: error.message });
  }
}

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
       VALUES (gen_random_uuid(), $1, NOW() AT TIME ZONE 'Asia/Manila', $2, 'OPEN', $3)
       RETURNING shift_id AS "shiftId", user_id AS "userId", clock_in AS "clockIn", COALESCE(opening_float, 1500.00)::numeric AS "openingFloat", COALESCE(status, 'OPEN') AS status`,
      [request.user.userId, openingFloat, notes]
    );

    logger.info('Employee clocked in', { userId: request.user.userId, shiftId: result.rows[0].shiftId, openingFloat });
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
      return response.status(409).json({ error: 'NO_OPEN_SHIFT', message: 'No active open shift found to clock out from' });
    }

    const openShift = openShiftCheck.rows[0];
    const clockInTime = openShift.clockIn;

    const salesResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0)::numeric AS gross,
              COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0)::numeric AS cash
       FROM orders
       WHERE employee_id = $1 AND status = 'completed'
         AND created_at >= $2`,
      [request.user.userId, clockInTime]
    );

    const openingFloat = Number(openShift.openingFloat) || 1500.00;
    const cashSales = Number(salesResult.rows[0].cash) || 0;
    const expectedCash = openingFloat + cashSales;
    const cashDiscrepancy = closingCashCount !== null ? closingCashCount - expectedCash : null;

    const updateResult = await pool.query(
      `UPDATE employee_shifts 
       SET clock_out = NOW() AT TIME ZONE 'Asia/Manila',
           closing_cash_count = $1,
           expected_cash = $2,
           cash_discrepancy = $3,
           status = 'CLOSED',
           notes = COALESCE($4, notes)
       WHERE shift_id = $5
       RETURNING shift_id AS "shiftId", user_id AS "userId", clock_in AS "clockIn", clock_out AS "clockOut", 
                 COALESCE(opening_float, 1500.00)::numeric AS "openingFloat", 
                 closing_cash_count AS "closingCashCount", expected_cash AS "expectedCash", 
                 cash_discrepancy AS "cashDiscrepancy", status, notes`,
      [closingCashCount, expectedCash, cashDiscrepancy, notes, openShift.shiftId]
    );

    logger.info('Employee clocked out', { 
      userId: request.user.userId, 
      shiftId: openShift.shiftId, 
      closingCashCount, 
      expectedCash, 
      cashDiscrepancy 
    });

    response.json(updateResult.rows[0]);
  } catch (error) {
    logger.error('Clock-out failed', { error: error.message });
    next(error); 
  }
});

// Employee Shifts List Endpoint
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

// Orders Endpoint
app.post('/api/v1/orders', auth.requireSession, async (request, response, next) => {
  const validation = validate(orderPayloadSchema, request.body);
  if (!validation.success) {
    logger.warn('Order creation validation failed', { errors: validation.errors });
    return response.status(400).json({ error: 'INVALID_ORDER', details: validation.errors });
  }

  const payload = validation.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO orders (order_id, customer_id, pricing_tier_id, employee_id, order_type, status, subtotal, tax_amount, total_amount, payment_method, cash_received, change_due, created_at)
       VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (order_id) DO NOTHING RETURNING order_id`,
      [payload.orderId, payload.customerId ?? null, payload.pricingTierId, request.user.userId, payload.orderType === 'commercial' ? 'commercial' : 'retail', payload.subtotal, payload.taxAmount ?? 0, payload.totalAmount, payload.paymentMethod, payload.cashReceived ?? 0, payload.changeDue ?? 0, payload.createdAt ?? new Date().toISOString()]
    );

    if (inserted.rowCount === 0) {
      await client.query('COMMIT');
      return response.json({ orderId: payload.orderId, duplicate: true });
    }

    if (payload.paymentMethod === 'cash' && Number(payload.cashReceived) < Number(payload.totalAmount)) {
      throw Object.assign(new Error('Cash received must be at least the order total'), { statusCode: 400, code: 'INSUFFICIENT_CASH' });
    }

    for (const item of payload.items) {
      const price = await client.query(
        `SELECT pp.price_per_unit FROM product_prices pp
         WHERE pp.variant_id=$1 AND pp.tier_id=$2 AND pp.min_quantity <= $3
         ORDER BY pp.min_quantity DESC LIMIT 1`,
        [item.variantId, payload.pricingTierId, item.quantity]
      );
      if (!price.rowCount || Number(price.rows[0].price_per_unit) !== Number(item.unitPrice)) {
        throw Object.assign(new Error('Price changed; review the cart'), { statusCode: 409, code: 'PRICE_CHANGED' });
      }

      const lots = await client.query(
        `SELECT lot_id, quantity_on_hand FROM inventory_lots
         WHERE variant_id=$1 AND quantity_on_hand > 0
         ORDER BY expiration_date NULLS LAST, lot_id FOR UPDATE`,
        [item.variantId]
      );

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
        throw Object.assign(new Error(`Insufficient inventory for ${item.variantId}`), { statusCode: 409, code: 'INSUFFICIENT_INVENTORY' });
      }

      for (const [allocationIndex, allocation] of allocations.entries()) {
        const update = await client.query(
          `UPDATE inventory_lots SET quantity_on_hand=quantity_on_hand-$1, updated_at=now()
           WHERE lot_id=$2 AND variant_id=$3 AND quantity_on_hand >= $1`,
          [allocation.quantity, allocation.lotId, item.variantId]
        );
        if (update.rowCount !== 1) {
          throw Object.assign(new Error('Inventory changed; retry checkout'), { statusCode: 409, code: 'INVENTORY_CONFLICT' });
        }
        await client.query(
          `INSERT INTO order_items (order_item_id, order_id, variant_id, lot_id, quantity, unit_price, total_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [allocationIndex === 0 ? item.orderItemId : crypto.randomUUID(), payload.orderId, item.variantId, allocation.lotId, allocation.quantity, item.unitPrice, Number(item.unitPrice) * allocation.quantity]
        );
      }
    }

    await client.query('COMMIT');
    logger.info('Order created successfully', { orderId: payload.orderId, totalAmount: payload.totalAmount });
    return response.status(201).json({ orderId: payload.orderId, synced: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('Order creation failed', { error: error.message });
    return next(error);
  } finally {
    client.release();
  }
});

// Sales Report Endpoint
app.get('/api/v1/sales/report', auth.requireSession, async (request, response, next) => {
  try {
    const date = String(request.query.date ?? new Date().toISOString().slice(0, 10));
    const start = `${date}T00:00:00+08:00`;
    const result = await pool.query(
      `SELECT o.order_id AS "orderId", o.created_at AS "soldAt",
              COALESCE(c.company_name || ' - ', '') || COALESCE(c.contact_name, 'Walk-in') AS "customerName",
              v.sku, v.variant_name AS "itemName", oi.quantity, oi.total_price AS amount, o.payment_method AS "paymentMethod"
       FROM order_items oi
       JOIN orders o ON o.order_id=oi.order_id
       JOIN product_variants v ON v.variant_id=oi.variant_id
       LEFT JOIN customers c ON c.customer_id=o.customer_id
       WHERE o.status='completed' AND o.created_at >= $1::timestamptz AND o.created_at < ($1::timestamptz + interval '1 day')
       ORDER BY o.created_at, o.order_id, oi.order_item_id`,
      [start]
    );

    const items = result.rows.map((row) => ({
      ...row,
      quantity: Number(row.quantity) || 0,
      amount: Number(row.amount) || 0,
    }));

    const summary = async (periodStart, periodEnd) => {
      const period = await pool.query(
        `SELECT COALESCE(SUM(total_amount), 0) AS gross, COUNT(order_id)::int AS orders
         FROM orders WHERE status='completed' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
        [periodStart, periodEnd]
      );
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
          summary(...periodBounds(yearStart, dateString(nextYear))),
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
      timezone: 'Asia/Manila',
    });
  } catch (error) { 
    logger.error('Sales report failed', { error: error.message });
    next(error); 
  }
});

// Sync Routes
const syncRouter = express.Router();

syncRouter.post('/push', auth.requireSession, async (request, response, next) => {
  const events = Array.isArray(request.body?.events) ? request.body.events : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const processed = [];
    for (const event of events) {
      if (!event.eventId || !event.entityType || !event.entityId || !event.operation || !event.payload || !event.idempotencyKey) {
        continue;
      }
      const existing = await client.query('SELECT event_id FROM sync_events WHERE idempotency_key = $1', [event.idempotencyKey]);
      if (existing.rowCount > 0) {
        processed.push(event.idempotencyKey);
        continue;
      }
      await client.query(
        `INSERT INTO sync_events (event_id, entity_type, entity_id, operation, payload, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [event.eventId, event.entityType, event.entityId, event.operation, event.payload, event.idempotencyKey]
      );
      processed.push(event.idempotencyKey);
    }
    await client.query('COMMIT');
    logger.info('Sync push processed', { count: processed.length });
    response.json({ processed, syncedAt: new Date().toISOString() });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('Sync push failed', { error: error.message });
    next(error);
  } finally {
    client.release();
  }
});

syncRouter.get('/pull', auth.requireSession, async (request, response, next) => {
  try {
    const since = request.query.since ? String(request.query.since) : new Date(0).toISOString();
    const result = await pool.query(
      `SELECT event_id AS "eventId", entity_type AS "entityType", entity_id AS "entityId",
              operation, payload, idempotency_key AS "idempotencyKey", created_at AS "createdAt"
       FROM sync_events WHERE created_at > $1::timestamptz ORDER BY created_at ASC LIMIT 500`,
      [since]
    );
    response.json({ events: result.rows, pulledAt: new Date().toISOString() });
  } catch (error) {
    logger.error('Sync pull failed', { error: error.message });
    next(error);
  }
});

app.use('/api/v1/sync', syncRouter);

// Units of Measure Endpoint
app.get('/api/v1/units-of-measure', auth.requireSession, async (_request, response, next) => {
  try {
    const result = await pool.query('SELECT uom_id AS "uomId", name, symbol FROM units_of_measure ORDER BY name');
    response.json(result.rows);
  } catch (error) {
    logger.error('Units of measure fetch failed', { error: error.message });
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  logger.error('Unhandled request error', { error: error.message, stack: error.stack });
  response.status(error.statusCode ?? 500).json({
    error: error.code ?? 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'production' ? undefined : error.message,
  });
});

async function start(port = Number(process.env.PORT ?? 3000)) {
  await migrate();
  return app.listen(port, () => logger.info(`Bake Alley cloud API listening on port ${port}`));
}

if (require.main === module) {
  start().catch((error) => {
    logger.error('Fatal startup error', { error: error.message, stack: error.stack });
    process.exitCode = 1;
  });
}

module.exports = { app, start };