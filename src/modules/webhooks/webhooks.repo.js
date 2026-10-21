// src/modules/webhooks/webhooks.repo.js
const { pool } = require('../../config/db');

exports.getTransactionForUpdate = async (client, checkoutId) => {
  const query = `
    SELECT id, tenant_id, router_id, plan_id, mac_address, status
    FROM transactions 
    WHERE checkout_id = $1 
    FOR UPDATE
  `;
  const { rows } = await client.query(query, [checkoutId]);
  return rows[0];
};

exports.markFailed = async (client, transactionId, rawCallback) => {
  const query = `
    UPDATE transactions 
    SET status = 'FAILED', raw_callback = $1 
    WHERE id = $2
  `;
  await client.query(query, [rawCallback, transactionId]);
};

exports.getPlanProfile = async (client, planId) => {
  const query = `SELECT mikrotik_profile, duration_min FROM hotspot_plans WHERE id = $1`;
  const { rows } = await client.query(query, [planId]);
  return rows[0];
};

exports.markSuccessAndQueueJob = async (client, transactionId, receipt, rawCallback, tenantId, routerId, payload) => {
  // 1. Update transaction to SUCCESS
  await client.query(`
    UPDATE transactions 
    SET status = 'SUCCESS', receipt = $1, raw_callback = $2 
    WHERE id = $3
  `, [receipt, rawCallback, transactionId]);

  // 2. Queue the provisioning job
  await client.query(`
    INSERT INTO provisioning_jobs (tenant_id, router_id, action, payload)
    VALUES ($1, $2, 'CREATE_USER', $3)
  `, [tenantId, routerId, payload]);
};