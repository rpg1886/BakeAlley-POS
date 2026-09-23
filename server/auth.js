const crypto = require('node:crypto');

const sessions = new Map();

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function requireSession(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const user = token ? sessions.get(token) : undefined;
  if (!user) return response.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
  request.user = user;
  request.sessionToken = token;
  return next();
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
      const result = await pool.query('SELECT user_id, username, display_name, role, password_salt, password_hash FROM app_users WHERE username = $1 AND active = TRUE', [username]);
      const row = result.rows[0];
      if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) return response.status(401).json({ error: 'INVALID_CREDENTIALS' });
      const token = crypto.randomUUID();
      const user = { userId: row.user_id, username: row.username, displayName: row.display_name, role: row.role };
      sessions.set(token, user);
      return response.json({ token, user });
    } catch (error) { return next(error); }
  });
  router.post('/auth/logout', requireSession, (request, response) => { sessions.delete(request.sessionToken); response.status(204).end(); });
  return { router, requireSession, requireAdmin };
}

module.exports = { createAuthRouter };
