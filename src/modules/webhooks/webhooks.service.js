// src/modules/webhooks/webhooks.service.js
const { pool } = require('../../config/db');
const webhooksRepo = require('./webhooks.repo');

exports.processMpesaCallback = async (callbackBody) => {
  const { CheckoutRequestID, ResultCode, CallbackMetadata } = callbackBody.Body.stkCallback;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock the transaction row (prevent double-processing)
    const tx = await webhooksRepo.getTransactionForUpdate(client, CheckoutRequestID);

    // 2. If tx doesn't exist OR already processed, exit gracefully
    if (!tx || tx.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return { processed: false, reason: 'Already processed or not found' };
    }

    // 3. Handle Failed Payment (User cancelled, insufficient funds, etc.)
    if (ResultCode !== 0) {
      await webhooksRepo.markFailed(client, tx.id, callbackBody);
      await client.query('COMMIT');
      return { processed: true, status: 'FAILED' };
    }

    // 4. Handle Successful Payment
    const mpesaReceipt = CallbackMetadata.Item.find(i => i.Name === 'MpesaReceiptNumber').Value;
    const plan = await webhooksRepo.getPlanProfile(client, tx.plan_id);

    const payload = {
      username: `u_${mpesaReceipt}`,
      password: mpesaReceipt.slice(-4),
      profile: plan.mikrotik_profile,
      macAddress: tx.mac_address,
      durationMin: plan.duration_min
    };

    await webhooksRepo.markSuccessAndQueueJob(
      client, tx.id, mpesaReceipt, callbackBody, tx.tenant_id, tx.router_id, payload
    );

    await client.query('COMMIT');
    return { processed: true, status: 'SUCCESS', receipt: mpesaReceipt };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};