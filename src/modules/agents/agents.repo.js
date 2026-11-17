const { pool } = require('../../config/db');

exports.updateHeartbeat = async (routerId) => {
  const query = `
    WITH updated_router AS (
      UPDATE routers
      SET last_seen_at = NOW(), health = 'ONLINE'
      WHERE id = $1
      RETURNING id
    )
    INSERT INTO router_heartbeat_minutes (router_id, bucket_at, ping_count)
    SELECT id, date_trunc('minute', NOW()), 1
    FROM updated_router
    ON CONFLICT (router_id, bucket_at)
    DO UPDATE SET ping_count = router_heartbeat_minutes.ping_count + 1
  `;
  await pool.query(query, [routerId]);
};

exports.recordPoll = async (routerId) => {
  const query = `
    WITH updated_router AS (
      UPDATE routers
      SET last_seen_at = NOW(), last_poll_at = NOW(), health = 'ONLINE'
      WHERE id = $1
      RETURNING id
    )
    INSERT INTO router_heartbeat_minutes (router_id, bucket_at, ping_count)
    SELECT id, date_trunc('minute', NOW()), 1
    FROM updated_router
    ON CONFLICT (router_id, bucket_at)
    DO UPDATE SET ping_count = router_heartbeat_minutes.ping_count + 1
  `;
  await pool.query(query, [routerId]);
};

exports.updateSetupStage = async (agentTokenHash, stage) => {
  const { rowCount } = await pool.query(
    `UPDATE routers
     SET setup_stage = $2, setup_updated_at = NOW()
     WHERE agent_token_hash = $1 AND active = TRUE
       AND uninstall_requested_at IS NULL`,
    [agentTokenHash, stage]
  );
  return rowCount;
};

// NEW: Function to mark a previous job as done
exports.markJobResult = async (jobId, success, errorMsg, routerId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE provisioning_jobs
       SET status = CASE
             WHEN action = 'UNINSTALL' AND $2 = FALSE THEN 'PENDING'::job_status
             ELSE $1::job_status
           END,
           completed_at = CASE
             WHEN action = 'UNINSTALL' AND $2 = FALSE THEN NULL
             ELSE NOW()
           END,
           last_error = $3
       WHERE id = $4 AND router_id = $5 AND status = 'CLAIMED'
       RETURNING tenant_id, router_id, action, payload`,
      [success ? 'SUCCESS' : 'FAILED', success, errorMsg || null, jobId, routerId]
    );
    const completedJob = rows[0];
    if (!completedJob) {
      await client.query('COMMIT');
      return null;
    }

    if (success && completedJob.action === 'CREATE_USER'
        && completedJob.payload.planId && completedJob.payload.durationMin) {
      await client.query(
        `INSERT INTO hotspot_users (
           tenant_id, router_id, username, mac_address, plan_id, expires_at
         )
         VALUES ($1, $2, $3, NULLIF($4, ''), $5::uuid,
                 NOW() + ($6::integer * INTERVAL '1 minute'))
         ON CONFLICT (router_id, username) DO NOTHING`,
        [
          completedJob.tenant_id,
          routerId,
          completedJob.payload.username,
          completedJob.payload.macAddress || '',
          completedJob.payload.planId,
          completedJob.payload.durationMin
        ]
      );
    }

    if (success && completedJob.action === 'UNINSTALL') {
      await client.query(
        `UPDATE routers
         SET uninstall_completed_at = NOW()
         WHERE id = $1 AND uninstall_requested_at IS NOT NULL`,
        [routerId]
      );
    }

    await client.query('COMMIT');
    return { action: completedJob.action };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

exports.completeRouterUninstall = async (routerId) => {
  const { rowCount } = await pool.query(
    `DELETE FROM routers
     WHERE id = $1
       AND uninstall_requested_at IS NOT NULL
       AND uninstall_completed_at IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM provisioning_jobs
         WHERE provisioning_jobs.router_id = routers.id
           AND provisioning_jobs.action = 'UNINSTALL'
           AND provisioning_jobs.status = 'SUCCESS'
       )`,
    [routerId]
  );
  return rowCount;
};

exports.claimNextJob = async (routerId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const selectQuery = `
      SELECT id, action, payload 
      FROM provisioning_jobs 
      WHERE router_id = $1 AND status = 'PENDING'
      ORDER BY CASE WHEN action = 'UNINSTALL' THEN 0 ELSE 1 END, created_at ASC
      LIMIT 1 
      FOR UPDATE SKIP LOCKED
    `;
    const { rows } = await client.query(selectQuery, [routerId]);
    const job = rows[0];

    if (!job) {
      await client.query('COMMIT');
      return null; 
    }

    const updateQuery = `
      UPDATE provisioning_jobs 
      SET status = 'CLAIMED', claimed_at = NOW(), attempts = attempts + 1 
      WHERE id = $1
    `;
    await client.query(updateQuery, [job.id]);

    await client.query('COMMIT');
    return job;

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};