const { pool } = require('../../config/db');

exports.getPlanPrice = async (planId, tenantId) => {
  const query = `
    SELECT price FROM hotspot_plans 
    WHERE id = $1 AND tenant_id = $2 AND active = TRUE
  `;
  const { rows } = await pool.query(query, [planId, tenantId]);
  return rows[0]; // Returns undefined if not found
};

exports.createTransaction = async (tenantId, routerId, planId, checkoutId, phone, amount, macAddress) => {
  const query = `
    INSERT INTO transactions (tenant_id, router_id, plan_id, checkout_id, phone, amount, mac_address, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
    RETURNING id;
  `;
  const values = [tenantId, routerId, planId, checkoutId, phone, amount, macAddress];
  const { rows } = await pool.query(query, values);
  return rows[0];
};