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
  .map(origin => origin.trim().replace(/\/+$/, '').toLowerCase());

logger.info('CORS allowed origins', { allowedOrigins });

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const sanitizedOrigin = origin.trim().replace(/\/+$/, '').toLowerCase();
    const isAllowed = allowedOrigins.some(allowed => allowed === sanitizedOrigin) || sanitizedOrigin.endsWith('.github.io');
    if (isAllowed) {
      callback(null, true);
    } else {
      logger.warn('CORS request blocked', { origin, allowedOrigins });
      callback(null, false);
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

// Employee List Endpoint - Filters Active Employees Only
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

// DELETE /api/v1/employees/:userId - Soft Delete Implementation
app.delete('/api/v1/employees/:userId', auth.requireSession, auth.requireAdmin, async (request, response, next) => {
  try {
    const { userId } = request.params;
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return response.status(400).json({ error: 'INVALID_USER_ID', message: 'User ID must be a valid UUID' });
    }

    if (userId === request.user.userId) {
      return response.status(400).json({ error: 'CANNOT_DELETE_SELF', message: 'You cannot delete your own logged-in admin account' });
    }

    const userCheck = await pool.query('SELECT user_id, username FROM app_users WHERE user_id = $1 AND active = TRUE', [userId]);
    if (!userCheck.rowCount) {
      return response.status(404).json({ error: 'USER_NOT_FOUND', message: 'Employee not found or already deactivated' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // 1. Soft-delete employee account
      await client.query('UPDATE app_users SET active = FALSE, updated_at = now() WHERE user_id = $1', [userId]);
      
      // 2. Immediately purge active login sessions to revoke API access
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