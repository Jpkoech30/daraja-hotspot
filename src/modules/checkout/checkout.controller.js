const checkoutService = require('./checkout.service');
const checkoutRepo = require('./checkout.repo');

exports.checkout = async (req, res, next) => {
  try {
    const { tenantId, routerId, planId, phone, macAddress } = req.body || {};

    // Basic validation
    if (!tenantId || !routerId || !planId || !phone
        || typeof macAddress !== 'string'
        || !/^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/i.test(macAddress)) {
      return res.status(400).json({
        success: false,
        error: 'Required fields and a valid client MAC address are required'
      });
    }

    const result = await checkoutService.initiateCheckout(
      tenantId, routerId, planId, phone, macAddress
    );
    
    res.status(200).json(result);
  } catch (error) {
    if (error.message === 'Invalid or inactive plan'
        || error.message === 'Invalid or inactive router') {
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

exports.getAccess = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const access = await checkoutRepo.getTransactionAccess(req.params.checkoutId);
    if (!access || !access.mac_address || access.mac_address.toLowerCase() !== String(req.query.mac || '').toLowerCase()) {
      return res.status(404).json({ error: 'Payment access not found' });
    }
    let loginUrl;
    try {
      loginUrl = new URL(String(req.query.loginUrl || ''));
    } catch {
      return res.status(400).json({ error: 'A valid router login URL is required' });
    }
    if (!['http:', 'https:'].includes(loginUrl.protocol)
        || loginUrl.username
        || loginUrl.password
        || loginUrl.hostname !== access.router_local_ip
        || loginUrl.pathname !== '/login') {
      return res.status(400).json({ error: 'Router login URL does not match the payment router' });
    }
    if (access.status !== 'SUCCESS') {
      return res.status(409).json({ error: 'Payment is not complete' });
    }
    if (access.provisioning_status === 'FAILED') {
      return res.status(409).json({ error: 'Router could not provision the paid access' });
    }
    if (access.provisioning_status !== 'SUCCESS'
        || !access.username
        || !access.password) {
      return res.status(202).json({ ready: false });
    }
    return res.status(200).json({
      ready: true,
      username: access.username,
      password: access.password,
      loginUrl: loginUrl.toString()
    });
  } catch (error) {
    return next(error);
  }
};