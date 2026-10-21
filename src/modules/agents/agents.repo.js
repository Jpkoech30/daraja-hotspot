// src/modules/agents/agents.repo.js
const { pool } = require('../../config/db');

// 1. Heartbeat: Update router health when it polls
exports.updateRouterHeartbeat = async (routerId) => {
  const query = `
    UPDATE routers 
    SET last_seen_at = NOW(), health = 'ONLINE'
    WHERE id = $1
  `;
  await pool.query(query, [routerId]);
};

// 2. The Job Claim (FOR UPDATE SKIP LOCKED)
exports.claimNextJob = async (routerId) => {
  // We use a transaction because we are SELECTing and UPDATEing atomically
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // The Magic Query:
    // Find the oldest PENDING job for this router.
    // FOR UPDATE locks the row.
    // SKIP LOCKED tells other simultaneous requests: "Don't wait for this row, go find another one."
    const query = `
      UPDATE provisioning_jobs
      SET status = 'CLAIMED', claimed_at = NOW(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM provisioning_jobs
        WHERE router_id = $1 AND status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, action, payload;
    `;
    
    const { rows } = await client.query(query, [routerId]);
    
    await client.query('COMMIT');
    return rows[0] || null; // Return the job, or null if queue is empty
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// 3. Report Job Result (Success or Failure)
exports.completeJob = async (jobId, success, errorMessage = null) => {
  const query = `
    UPDATE provisioning_jobs
    SET status = $2, completed_at = NOW(), last_error = $3
    WHERE id = $1
  `;
  const status = success ? 'SUCCESS' : 'FAILED';
  await pool.query(query, [jobId, status, errorMessage]);
};