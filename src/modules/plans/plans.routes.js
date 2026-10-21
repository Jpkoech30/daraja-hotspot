const express = require('express');
const plansController = require('./plans.controller');
const router = express.Router();

// GET /api/portal/plans/:tenantId
router.get('/:tenantId', plansController.getPlans);

module.exports = router;