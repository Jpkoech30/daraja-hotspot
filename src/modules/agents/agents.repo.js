const { pool } = require('../../config/db');

exports.updateHeartbeat = async (routerId) => {
  const query = `
    UPDATE routers 
    SET last_seen_at = NOW(), health = 'ONLINE' 
    WHERE id = $1
  `;
  await pool.query(query, [routerId]);
};

// NEW: Function to mark a previous job as done
exports.markJobResult = async (jobId, success, errorMsg, routerId) => {
  const query = `
    UPDATE provisioning_jobs 
    SET status = $1, 
        completed_at = NOW(), 
        last_error = $2 
    WHERE id = $3 AND router_id = $4 AND status = 'CLAIMED'
  `;
  const status = success ? 'SUCCESS' : 'FAILED';
  const { rowCount } = await pool.query(query, [status, errorMsg || null, jobId, routerId]);
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
      ORDER BY created_at ASC 
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