const crypto = require('node:crypto');
const { pool, migrate } = require('../db');

async function main() {
  const username = process.env.CLOUD_ADMIN_USERNAME;
  const displayName = process.env.CLOUD_ADMIN_DISPLAY_NAME;
  const password = process.env.CLOUD_ADMIN_PASSWORD;
  if (!username || !displayName || !password || password.length < 12) throw new Error('Set CLOUD_ADMIN_USERNAME, CLOUD_ADMIN_DISPLAY_NAME, and a 12+ character CLOUD_ADMIN_PASSWORD');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  await migrate();
  await pool.query(`INSERT INTO app_users (user_id, username, display_name, role, password_salt, password_hash) VALUES (gen_random_uuid(), $1, $2, 'admin', $3, $4) ON CONFLICT (username) DO UPDATE SET display_name=EXCLUDED.display_name, password_salt=EXCLUDED.password_salt, password_hash=EXCLUDED.password_hash, role='admin', active=TRUE, updated_at=now()`, [username.toLowerCase(), displayName, salt, hash]);
  console.log(`Seeded cloud administrator: ${username}`);
  await pool.end();
}
main().catch(async (error) => { console.error(error); await pool.end(); process.exitCode = 1; });
