// src/modules/admin/admin.repo.js
const { pool } = require('../../config/db');

// --- M-Pesa Settings ---
exports.updateMpesaSettings = async (tenantId, shortcode, keyEnc, secretEnc) => {
  const query = `
    UPDATE tenants 
    SET mpesa_shortcode = $1, mpesa_key_enc = $2, mpesa_secret_enc = $3
    WHERE id = $4
    RETURNING id, mpesa_shortcode;
  `;
  const { rows } = await pool.query(query, [shortcode, keyEnc, secretEnc, tenantId]);
  return rows[0];
};

// --- Dashboard Stats ---
exports.getStats = async (tenantId) => {
  const query = `
    SELECT 
      COALESCE(SUM(amount), 0) AS total_revenue,
      COUNT(id) AS total_transactions,
      (SELECT COUNT(*) FROM routers WHERE tenant_id = $1 AND health = 'ONLINE') AS online_routers
    FROM transactions
    WHERE tenant_id = $1 AND status = 'SUCCESS'
  `;
  const { rows } = await pool.query(query, [tenantId]);
  return rows[0];
};

// --- Plans Management ---
exports.getPlans = async (tenantId) => {
  const query = `SELECT * FROM hotspot_plans WHERE tenant_id = $1 ORDER BY price ASC`;
  const { rows } = await pool.query(query, [tenantId]);
  return rows;
};

exports.createPlan = async (tenantId, name, price, durationMin, profile) => {
  const query = `
    INSERT INTO hotspot_plans (tenant_id, name, price, duration_min, mikrotik_profile)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [tenantId, name, price, durationMin, profile]);
  return rows[0];
};