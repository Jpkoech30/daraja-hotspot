const { pool } = require('../../config/db');

exports.findActivePlansByTenant = async (tenantId) => {
  const query = `
    SELECT id, name, price, duration_min AS "durationMin", mikrotik_profile AS "profile"
    FROM hotspot_plans 
    WHERE tenant_id = $1 AND active = TRUE
    ORDER BY price ASC
  `;
  const { rows } = await pool.query(query, [tenantId]);
  return rows;
};