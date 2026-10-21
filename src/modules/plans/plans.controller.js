const plansService = require('./plans.service');

exports.getPlans = async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const plans = await plansService.getPlansForTenant(tenantId);
    
    res.status(200).json({
      success: true,
      data: plans
    });
  } catch (error) {
    if (error.message === 'No active plans found for this ISP') {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error); 
  }
};