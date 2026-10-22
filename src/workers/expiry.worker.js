const cron = require('node-cron');
const { pool } = require('../config/db');

const enqueueExpiredUsers = async () => {
  const query = `
    WITH expired_users AS (
      DELETE FROM hotspot_users
      WHERE expires_at <= NOW()
      RETURNING tenant_id, router_id, username
    )
    INSERT INTO provisioning_jobs (tenant_id, router_id, action, payload)
    SELECT tenant_id, router_id, 'DISABLE_USER', jsonb_build_object('username', username)
    FROM expired_users
    RETURNING id
  `;
  const { rowCount } = await pool.query(query);
  if (rowCount > 0) {
    console.log(`[Expiry Worker] Queued ${rowCount} expired user(s) for disconnection`);
  }
};

exports.startExpiryWorker = () => {
  let isRunning = false;

  return cron.schedule('* * * * *', async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await enqueueExpiredUsers();
    } catch (error) {
      console.error('[Expiry Worker] Failed to process expired users:', error);
    } finally {
      isRunning = false;
    }
  });
};
