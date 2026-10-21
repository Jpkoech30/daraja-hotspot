// src/modules/webhooks/webhooks.controller.js
const webhooksService = require('./webhooks.service');

exports.mpesaCallback = async (req, res) => {
  try {
    // Fire the logic in the background, don't wait for it
    webhooksService.processMpesaCallback(req.body)
      .then(result => console.log('[Webhook] Result:', result))
      .catch(err => console.error('[Webhook] Error:', err.message));

    // Always respond 200 to Safaricom instantly
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('[Webhook] Fatal:', error);
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
};