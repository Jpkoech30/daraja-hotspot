const checkoutService = require('./checkout.service');
const checkoutRepo = require('./checkout.repo');

exports.checkout = async (req, res, next) => {
  try {
    const { tenantId, routerId, planId, phone, macAddress } = req.body;

    // Basic validation
    if (!tenantId || !routerId || !planId || !phone) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const result = await checkoutService.initiateCheckout(
      tenantId, routerId, planId, phone, macAddress
    );
    
    res.status(200).json(result);
  } catch (error) {
    if (error.message === 'Invalid or inactive plan') {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  }
};

exports.getStatus = async (req, res, next) => {
  try {
    const transaction = await checkoutRepo.getTransactionStatus(req.params.checkoutId);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const status = transaction.status === 'CANCELLED' ? 'FAILED' : transaction.status;
    return res.status(200).json({ status });
  } catch (error) {
    return next(error);
  }
};