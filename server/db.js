const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const logger = require('./logger');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the cloud API');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', { error: err.message });
  process.exit(-1);
});

pool.on('connect', () => {
  logger.debug('New database connection established');
});

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '001_cloud_pos.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    logger.info('Database migration completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Database migration failed', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

// Clean up expired sessions every hour
async function cleanupExpiredSessions() {
  try {
    const result = await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
    if (result.rowCount > 0) {
      logger.info('Expired sessions cleaned up', { count: result.rowCount });
    }
  } catch (error) {
    logger.error('Failed to cleanup expired sessions', { error: error.message });
  }
}

// Start cleanup job on initialization
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);
cleanupExpiredSessions(); // Run once on startup

module.exports = { pool, migrate, cleanupExpiredSessions };
