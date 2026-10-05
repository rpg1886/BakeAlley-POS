const crypto = require('node:crypto');
const logger = require('./logger');

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function requireSession(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return response.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
  
  try {
    const pool = request.pool;
    const result = await pool.query(
      'SELECT u.user_id, u.username, u.display_name, u.role FROM sessions s JOIN app_users u ON u.user_id = s.user_id WHERE s.token = $1 AND s.expires_at > NOW()',
      [token]
    );
    
    if (!result.rows[0]) {
      logger.warn('Session lookup failed or expired', { token: token.substring(0, 8) + '...' });
      return response.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
    }
    
    const user = result.rows[0];
    request.user = { userId: user.user_id, username: user.username, displayName: user.display_name, role: user.role };
    request.sessionToken = token;
    return next();
  } catch (error) {
    logger.error('Session verification error', { error: error.message });
    return next(error);
  }
}

function requireAdmin(request, response, next) {
  if (request.user?.role !== 'admin') return response.status(403).json({ error: 'ADMIN_REQUIRED' });
  return next();
}

function createAuthRouter(express, pool) {
  const router = express.Router();
  
  router.post('/auth/login', async (request, response, next) => {
    try {
      const username = String(request.body?.username ?? '').trim().toLowerCase();
      const password = String(request.body?.password ?? '');
      
      if (!username || !password) {
        return response.status(400).json({ error: 'INVALID_CREDENTIALS' });
      }
      
      const result = await pool.query(
        'SELECT user_id, username, display_name, role, password_salt, password_hash FROM app_users WHERE username = $1 AND active = TRUE',
        [username]
      );
      
      const row = result.rows[0];
      if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
        logger.warn('Failed login attempt', { username });
        return response.status(401).json({ error: 'INVALID_CREDENTIALS' });
      }
      
      // Create session token with 24-hour expiry
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      await pool.query(
        'INSERT INTO sessions (session_id, user_id, token, expires_at) VALUES (gen_random_uuid(), $1, $2, $3)',
        [row.user_id, token, expiresAt.toISOString()]
      );
      
      const user = { userId: row.user_id, username: row.username, displayName: row.display_name, role: row.role };
      logger.info('User logged in', { username });
      return response.json({ token, user });
    } catch (error) { 
      logger.error('Login error', { error: error.message });
      return next(error); 
    }
  });
  
  router.post('/auth/logout', async (request, response, next) => {
    try {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (token) {
        await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
      }
      logger.info('User logged out');
      return response.status(204).end();
    } catch (error) {
      logger.error('Logout error', { error: error.message });
      return next(error);
    }
  });
  
  return { router, requireSession, requireAdmin };
}

module.exports = { createAuthRouter };

