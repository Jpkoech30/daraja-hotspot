const adminService = require('./admin.service');

exports.saveMpesaSettings = async (req, res, next) => {
  try {
    const { shortcode, consumerKey, consumerSecret, passkey } = req.body || {};
    const result = await adminService.saveMpesaSettings(
      req.tenantId, shortcode, consumerKey, consumerSecret, passkey
    );
    if (!result) return res.status(404).json({ error: 'ISP account not found' });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'All M-Pesa fields are required') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
};

exports.getMpesaSettings = async (req, res, next) => {
  try {
    const settings = await adminService.getMpesaSettings(req.tenantId);
    if (!settings) return res.status(404).json({ error: 'ISP account not found' });
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

exports.clearMpesaSettings = async (req, res, next) => {
  try {
    const result = await adminService.clearMpesaSettings(req.tenantId);
    if (!result) return res.status(404).json({ error: 'ISP account not found' });
    res.status(200).json({ success: true });
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

exports.getDashboardOverview = async (req, res, next) => {
  try {
    const days = req.query.days === undefined ? 30 : Number(req.query.days);
    const overview = await adminService.getDashboardOverview(req.tenantId, days);
    res.status(200).json({ success: true, data: overview });
  } catch (error) {
    if (error.message === 'Dashboard period must be 7, 30, or 90 days') {
      return res.status(400).json({ success: false, error: error.message });
    }
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
    const plan = await adminService.createPlan(req.tenantId, req.body || {});
    res.status(201).json({ success: true, data: plan });
  } catch (error) {
    if (error.message.startsWith('Plan ') || error.message === 'Plan name and profile are required') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
};

exports.updatePlan = async (req, res, next) => {
  try {
    const plan = await adminService.updatePlan(req.tenantId, req.params.planId, req.body || {});
    res.status(200).json({ success: true, data: plan });
  } catch (error) {
    if (error.message === 'Plan not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message.startsWith('Plan ')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
};

exports.archivePlan = async (req, res, next) => {
  try {
    const plan = await adminService.archivePlan(req.tenantId, req.params.planId);
    res.status(200).json({ success: true, data: plan });
  } catch (error) {
    if (error.message === 'Plan not found') {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
};

exports.createRouter = async (req, res, next) => {
  try {
    const { name, lanInterface } = req.body || {};
    const result = await adminService.generateRouterScript(
      req.tenantId,
      name,
      lanInterface
    );
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'Router name is required'
        || error.message === 'Router hotspot interface name is invalid'
        || error.message === 'Router setup cannot include a bundle profile with invalid characters') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
};

exports.getRouters = async (req, res, next) => {
  try {
    const routers = await adminService.getRouters(req.tenantId);
    res.status(200).json({ success: true, data: routers });
  } catch (error) {
    next(error);
  }
};

exports.updateRouter = async (req, res, next) => {
  try {
    const router = await adminService.updateRouter(req.tenantId, req.params.routerId, req.body || {});
    res.status(200).json({ success: true, data: router });
  } catch (error) {
    if (error.message === 'Router not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message.startsWith('Router ')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
};

exports.archiveRouter = async (req, res, next) => {
  try {
    const router = await adminService.archiveRouter(req.tenantId, req.params.routerId);
    res.status(200).json({ success: true, data: router });
  } catch (error) {
    if (error.message === 'Router not found') {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
};

exports.deleteRouters = async (req, res, next) => {
  try {
    const result = await adminService.deleteRouters(
      req.tenantId,
      req.body?.routerIds
    );
    res.status(202).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'Select at least one router to delete'
        || error.message === 'Router selection contains an invalid router ID') {
      return res.status(400).json({ error: error.message });
    }
    if (error.message.startsWith('Routers with payment history')) {
      return res.status(409).json({ error: error.message });
    }
    if (error.message === 'One or more selected routers were not found') {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
};