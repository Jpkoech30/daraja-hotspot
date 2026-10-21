const plansRepo = require('./plans.repo');

exports.getPlansForTenant = async (tenantId) => {
  const plans = await plansRepo.findActivePlansByTenant(tenantId);
  
  if (plans.length === 0) {
    throw new Error('No active plans found for this ISP');
  }
  
  return plans;
};