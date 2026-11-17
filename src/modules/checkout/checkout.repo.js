const { pool } = require('../../config/db');

exports.getPlanPrice = async (planId, tenantId) => {
  const query = `
    SELECT price, duration_min, mikrotik_profile
    FROM hotspot_plans
    WHERE id = $1 AND tenant_id = $2 AND active = TRUE
  `;
  const { rows } = await pool.query(query, [planId, tenantId]);
  return rows[0]; // Returns undefined if not found
};

exports.getActiveRouter = async (routerId, tenantId) => {
  const { rows } = await pool.query(
    `SELECT id FROM routers
     WHERE id = $1 AND tenant_id = $2 AND active = TRUE
       AND uninstall_requested_at IS NULL`,
    [routerId, tenantId]
  );
  return rows[0];
};

exports.createTransaction = async (
  tenantId, routerId, planId, checkoutId, phone, amount, planDurationMin, planProfile, macAddress
) => {
  const query = `
    INSERT INTO transactions (
      tenant_id, router_id, plan_id, checkout_id, phone, amount,
      plan_duration_min, plan_mikrotik_profile, mac_address, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
    RETURNING id;
  `;
  const values = [
    tenantId, routerId, planId, checkoutId, phone, amount,
    planDurationMin, planProfile, macAddress
  ];
  const { rows } = await pool.query(query, values);
  return rows[0];
};

exports.getTransactionStatus = async (checkoutId) => {
  const { rows } = await pool.query(
    'SELECT status FROM transactions WHERE checkout_id = $1',
    [checkoutId]
  );
  return rows[0];
};

exports.getTransactionAccess = async (checkoutId) => {
  const { rows } = await pool.query(
    `SELECT transactions.status,
            transactions.mac_address,
            provisioning_jobs.status AS provisioning_status,
            provisioning_jobs.payload->>'username' AS username,
            provisioning_jobs.payload->>'password' AS password,
            routers.local_ip AS router_local_ip
     FROM transactions
     JOIN routers ON routers.id = transactions.router_id
     LEFT JOIN provisioning_jobs
       ON provisioning_jobs.router_id = transactions.router_id
      AND provisioning_jobs.action = 'CREATE_USER'
      AND provisioning_jobs.payload->>'username' = 'u_' || transactions.receipt
     WHERE transactions.checkout_id = $1
     ORDER BY provisioning_jobs.created_at DESC NULLS LAST
     LIMIT 1`,
    [checkoutId]
  );
  return rows[0];
};

exports.getTenantMpesaSettings = async (tenantId) => {
  const query = `
    SELECT mpesa_shortcode, mpesa_key_enc, mpesa_secret_enc, mpesa_passkey_enc
    FROM tenants 
    WHERE id = $1
  `;
  const { rows } = await pool.query(query, [tenantId]);
  return rows[0];
};