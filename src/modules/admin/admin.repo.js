const { pool } = require('../../config/db');

// --- M-Pesa Settings ---
exports.updateMpesaSettings = async (tenantId, shortcode, keyEnc, secretEnc, passkeyEnc) => {
  const query = `
    UPDATE tenants 
    SET mpesa_shortcode = $1, mpesa_key_enc = $2, mpesa_secret_enc = $3, mpesa_passkey_enc = $4
    WHERE id = $5
    RETURNING id, mpesa_shortcode;
  `;
  const { rows } = await pool.query(query, [shortcode, keyEnc, secretEnc, passkeyEnc, tenantId]);
  return rows[0];
};

exports.getMpesaSettings = async (tenantId) => {
  const query = `
    SELECT mpesa_shortcode,
           (mpesa_key_enc IS NOT NULL AND mpesa_secret_enc IS NOT NULL
            AND mpesa_passkey_enc IS NOT NULL) AS configured
    FROM tenants
    WHERE id = $1
  `;
  const { rows } = await pool.query(query, [tenantId]);
  return rows[0];
};

exports.clearMpesaSettings = async (tenantId) => {
  const query = `
    UPDATE tenants
    SET mpesa_shortcode = NULL, mpesa_key_enc = NULL, mpesa_secret_enc = NULL, mpesa_passkey_enc = NULL
    WHERE id = $1
    RETURNING id
  `;
  const { rows } = await pool.query(query, [tenantId]);
  return rows[0];
};

// --- Dashboard Stats ---
exports.getStats = async (tenantId) => {
  const query = `
    SELECT 
      COALESCE(SUM(amount), 0) AS total_revenue,
      COUNT(id) AS total_transactions,
      (SELECT COUNT(*) FROM routers WHERE tenant_id = $1 AND active = TRUE AND health = 'ONLINE') AS online_routers
    FROM transactions
    WHERE tenant_id = $1 AND status = 'SUCCESS'
  `;
  const { rows } = await pool.query(query, [tenantId]);
  return rows[0];
};

exports.getDashboardOverview = async (tenantId, days) => {
  const range = Number(days);
  const values = [tenantId, range];
  const [summaryResult, revenueResult, provisioningResult, paymentsResult, pingResult] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE status = 'SUCCESS'), 0) AS revenue,
         COUNT(*) FILTER (WHERE status = 'SUCCESS')::integer AS successful_payments,
         COUNT(*) FILTER (WHERE status = 'PENDING')::integer AS pending_payments,
         COUNT(*) FILTER (WHERE status = 'FAILED')::integer AS failed_payments,
         COUNT(*) FILTER (WHERE status = 'CANCELLED')::integer AS cancelled_payments
       FROM transactions
       WHERE tenant_id = $1
         AND created_at >= CURRENT_DATE - (($2::integer - 1) * INTERVAL '1 day')
         AND created_at < CURRENT_DATE + INTERVAL '1 day'`,
      values
    ),
    pool.query(
      `WITH days AS (
         SELECT generate_series(
           CURRENT_DATE - (($2::integer - 1) * INTERVAL '1 day'),
           CURRENT_DATE,
           INTERVAL '1 day'
         )::date AS day
       )
       SELECT days.day::text AS date,
              COALESCE(SUM(transactions.amount), 0) AS revenue,
              COUNT(transactions.id)::integer AS transactions
       FROM days
       LEFT JOIN transactions
         ON transactions.tenant_id = $1
        AND transactions.status = 'SUCCESS'
        AND transactions.created_at >= days.day
        AND transactions.created_at < days.day + INTERVAL '1 day'
       GROUP BY days.day
       ORDER BY days.day`,
      values
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'PENDING')::integer AS pending,
         COUNT(*) FILTER (WHERE status = 'CLAIMED')::integer AS claimed,
         COUNT(*) FILTER (WHERE status = 'SUCCESS')::integer AS successful,
         COUNT(*) FILTER (WHERE status = 'FAILED')::integer AS failed
       FROM provisioning_jobs
       WHERE tenant_id = $1
         AND action = 'CREATE_USER'
         AND created_at >= CURRENT_DATE - (($2::integer - 1) * INTERVAL '1 day')
         AND created_at < CURRENT_DATE + INTERVAL '1 day'`,
      values
    ),
    pool.query(
      `SELECT transactions.id, transactions.phone, transactions.amount,
              transactions.status, transactions.created_at
       FROM transactions
       WHERE transactions.tenant_id = $1
         AND transactions.created_at >= CURRENT_DATE - (($2::integer - 1) * INTERVAL '1 day')
         AND transactions.created_at < CURRENT_DATE + INTERVAL '1 day'
       ORDER BY transactions.created_at DESC
       LIMIT 10`,
      values
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(router_heartbeat_minutes.ping_count)
           FILTER (WHERE router_heartbeat_minutes.bucket_at >= NOW() - INTERVAL '24 hours'), 0)::integer AS received_24h,
         COALESCE(SUM(router_heartbeat_minutes.ping_count)
           FILTER (WHERE router_heartbeat_minutes.bucket_at >= NOW() - INTERVAL '1 hour'), 0)::integer AS received_1h,
         (SELECT COUNT(*)::integer
          FROM routers
          WHERE tenant_id = $1 AND active = TRUE
            AND last_seen_at >= NOW() - INTERVAL '2 minutes') AS online_routers,
         (SELECT COUNT(*)::integer
          FROM routers
          WHERE tenant_id = $1 AND active = TRUE
            AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '2 minutes')) AS offline_routers,
         (SELECT MAX(last_seen_at)
          FROM routers WHERE tenant_id = $1 AND active = TRUE) AS last_ping_at
       FROM tenants
       LEFT JOIN routers ON routers.tenant_id = tenants.id
       LEFT JOIN router_heartbeat_minutes
         ON router_heartbeat_minutes.router_id = routers.id
       WHERE tenants.id = $1`,
      [tenantId]
    )
  ]);

  return {
    days: range,
    payments: summaryResult.rows[0],
    dailyRevenue: revenueResult.rows,
    provisioning: provisioningResult.rows[0],
    pings: pingResult.rows[0],
    recentPayments: paymentsResult.rows.map(({ phone, ...payment }) => ({
      ...payment,
      phone: maskPhoneNumber(phone)
    }))
  };
};

function maskPhoneNumber(phone) {
  if (typeof phone !== 'string' || phone.length <= 4) return '••••';
  return `••••${phone.slice(-4)}`;
}

// --- Plans Management ---
exports.getPlans = async (tenantId) => {
  const query = `SELECT id, name, price, duration_min, mikrotik_profile, active, created_at
                 FROM hotspot_plans WHERE tenant_id = $1 ORDER BY active DESC, price ASC`;
  const { rows } = await pool.query(query, [tenantId]);
  return rows;
};

exports.updatePlan = async (tenantId, planId, name, price, durationMin, profile, active) => {
  const query = `
    UPDATE hotspot_plans
    SET name = $1, price = $2, duration_min = $3, mikrotik_profile = $4,
        active = COALESCE($5, active)
    WHERE id = $6 AND tenant_id = $7
    RETURNING id, name, price, duration_min, mikrotik_profile, active, created_at
  `;
  const { rows } = await pool.query(query, [
    name, price, durationMin, profile, active, planId, tenantId
  ]);
  return rows[0];
};

exports.archivePlan = async (tenantId, planId) => {
  const { rows } = await pool.query(
    `UPDATE hotspot_plans SET active = FALSE WHERE id = $1 AND tenant_id = $2
     RETURNING id, active`,
    [planId, tenantId]
  );
  return rows[0];
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

// --- Routers Management ---
exports.createRouter = async (tenantId, name, localIp, agentTokenHash) => {
  const query = `
    INSERT INTO routers (tenant_id, name, local_ip, agent_token_hash)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, local_ip;
  `;
  const { rows } = await pool.query(query, [tenantId, name, localIp, agentTokenHash]);
  return rows[0];
};

exports.getRouterByAgentTokenHash = async (agentTokenHash) => {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, name, local_ip
     FROM routers
     WHERE agent_token_hash = $1 AND active = TRUE
       AND uninstall_requested_at IS NULL
     LIMIT 1`,
    [agentTokenHash]
  );
  return rows[0];
};

exports.updateRouterGatewayByAgentTokenHash = async (agentTokenHash, localIp) => {
  const { rows } = await pool.query(
    `UPDATE routers
     SET local_ip = $2
     WHERE agent_token_hash = $1 AND active = TRUE
       AND uninstall_requested_at IS NULL
     RETURNING id, local_ip`,
    [agentTokenHash, localIp]
  );
  return rows[0];
};

exports.getRouterPortalDetailsByAgentTokenHash = async (agentTokenHash, routerId) => {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, name
     FROM routers
     WHERE agent_token_hash = $1 AND id = $2 AND active = TRUE
       AND uninstall_requested_at IS NULL
     LIMIT 1`,
    [agentTokenHash, routerId]
  );
  return rows[0];
};

exports.getRouters = async (tenantId) => {
  const { rows } = await pool.query(
    `SELECT routers.id, routers.name, routers.local_ip,
            CASE
              WHEN routers.health = 'UNHEALTHY' THEN 'UNHEALTHY'
              WHEN routers.last_seen_at >= NOW() - INTERVAL '2 minutes' THEN 'ONLINE'
              ELSE 'OFFLINE'
            END AS health,
            routers.last_seen_at, routers.last_poll_at,
            routers.setup_stage, routers.setup_updated_at,
            routers.uninstall_requested_at, routers.uninstall_completed_at,
            routers.active, routers.created_at,
            COALESCE((
              SELECT COUNT(*)::integer
              FROM transactions
              WHERE transactions.router_id = routers.id
            ), 0)::integer AS transaction_count,
            COALESCE((
              SELECT SUM(ping_count)::integer
              FROM router_heartbeat_minutes
              WHERE router_id = routers.id
                AND bucket_at >= NOW() - INTERVAL '1 hour'
            ), 0)::integer AS pings_last_hour
     FROM routers WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  );
  return rows;
};

exports.updateRouter = async (tenantId, routerId, name, localIp, active) => {
  const { rows } = await pool.query(
    `UPDATE routers
     SET name = $1, local_ip = $2, active = COALESCE($3, active)
     WHERE id = $4 AND tenant_id = $5 AND uninstall_requested_at IS NULL
     RETURNING id, name, local_ip, health, last_seen_at, active, created_at`,
    [name, localIp, active, routerId, tenantId]
  );
  return rows[0];
};

exports.archiveRouter = async (tenantId, routerId) => {
  const { rows } = await pool.query(
    `UPDATE routers SET active = FALSE
     WHERE id = $1 AND tenant_id = $2 AND uninstall_requested_at IS NULL
     RETURNING id, active`,
    [routerId, tenantId]
  );
  return rows[0];
};

exports.deleteRouters = async (tenantId, routerIds) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT routers.id, routers.name, routers.uninstall_requested_at,
              routers.uninstall_completed_at,
              EXISTS (
                SELECT 1 FROM transactions
                WHERE transactions.router_id = routers.id
              ) AS has_transactions
       FROM routers
       WHERE routers.tenant_id = $1 AND routers.id = ANY($2::uuid[])
       FOR UPDATE`,
      [tenantId, routerIds]
    );

    if (rows.length !== routerIds.length) {
      await client.query('ROLLBACK');
      throw new Error('One or more selected routers were not found');
    }

    const blockedRouters = rows
      .filter(router => router.has_transactions)
      .map(router => router.name);
    if (blockedRouters.length) {
      await client.query('ROLLBACK');
      return { requestedCount: 0, alreadyPendingCount: 0, blockedRouters };
    }

    for (const router of rows) {
      await client.query(
        `UPDATE routers
         SET uninstall_requested_at = COALESCE(uninstall_requested_at, NOW())
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, router.id]
      );
      await client.query(
        `INSERT INTO provisioning_jobs (tenant_id, router_id, action, payload)
         SELECT $1, $2, 'UNINSTALL', '{}'::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM routers
           WHERE id = $2 AND uninstall_completed_at IS NOT NULL
         )
           AND NOT EXISTS (
           SELECT 1 FROM provisioning_jobs
           WHERE router_id = $2 AND action = 'UNINSTALL'
             AND status IN ('PENDING', 'CLAIMED')
         )`,
        [tenantId, router.id]
      );
    }
    await client.query('COMMIT');
    return {
      requestedCount: rows.length,
      alreadyPendingCount: rows.filter(router => router.uninstall_requested_at).length,
      blockedRouters: []
    };
  } catch (error) {
    if (error.message !== 'One or more selected routers were not found') {
      await client.query('ROLLBACK');
    }
    throw error;
  } finally {
    client.release();
  }
};