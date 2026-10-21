const adminService = require('./admin.service');

exports.saveMpesaSettings = async (req, res, next) => {
  try {
    const { shortcode, consumerKey, consumerSecret } = req.body;
    const result = await adminService.saveMpesaSettings(req.tenantId, shortcode, consumerKey, consumerSecret);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.getStats = async (req, res, next) => {
  try {
    const stats = await adminService.getDashboardStats(req.tenantId);
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

exports.getPlans = async (req, res, next) => {
  try {
    const plans = await adminService.getPlans(req.tenantId);
    res.status(200).json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
};

exports.createPlan = async (req, res, next) => {
  try {
    const plan = await adminService.createPlan(req.tenantId, req.body);
    res.status(201).json({ success: true, data: plan });
  } catch (error) {
    if (error.message === 'Missing required plan fields') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
};

exports.createRouter = async (req, res, next) => {
  try {
    const { name, localIp } = req.body;
    if (!name) return res.status(400).json({ error: 'Router name is required' });
    
    const result = await adminService.generateRouterScript(req.tenantId, name, localIp || '192.168.88.1');
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};