require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./src/config/db');

const DEFAULT_EMAIL = 'admin@eldoretfastnet.co.ke';
const DEFAULT_PASSWORD = 'password123';

async function fixAdminAuth() {
  const passwordHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);

  const { rows } = await pool.query(
    `SELECT id, email FROM tenants WHERE LOWER(TRIM(email)) IN ($1, $2) ORDER BY CASE LOWER(TRIM(email)) WHEN $1 THEN 0 ELSE 1 END LIMIT 1`,
    [DEFAULT_EMAIL.toLowerCase(), 'admin@eldoretfast.co.ke']
  );

  if (!rows.length) {
    console.log('No admin tenant found. Nothing to update.');
    process.exit(0);
  }

  const tenant = rows[0];
  await pool.query(
    `UPDATE tenants SET email = $1, password_hash = $2 WHERE id = $3`,
    [DEFAULT_EMAIL, passwordHash, tenant.id]
  );

  console.log(`Updated tenant ${tenant.id} (${tenant.email || DEFAULT_EMAIL}) to use the default admin credentials.`);
  process.exit(0);
}

fixAdminAuth().catch((error) => {
  console.error('Failed to repair admin auth:', error.message);
  process.exit(1);
});
