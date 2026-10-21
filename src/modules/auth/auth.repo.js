const { pool } = require('../../config/db');

exports.findTenantByEmail = async (email) => {
  const query = `SELECT id, name, email, password_hash, status FROM tenants WHERE email = $1`;
  const { rows } = await pool.query(query, [email]);
  return rows[0];
};
