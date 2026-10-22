const express = require('express');
const adminController = require('./admin.controller');
const { requireAuth } = require('../../middlewares/auth.middleware'); 

const router = express.Router();

router.use(requireAuth);

// Dashboard Stats
router.get('/stats', adminController.getStats);

// Plan Management
router.get('/plans', adminController.getPlans);
router.post('/plans', adminController.createPlan);

// M-Pesa Settings
router.post('/settings/mpesa', adminController.saveMpesaSettings);

// Router Management
router.post('/routers', adminController.createRouter);

module.exports = router;