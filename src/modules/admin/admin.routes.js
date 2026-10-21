const express = require('express');
const adminController = require('./admin.controller');
const { requireAuth } = require('../../middlewares/auth.middleware'); 

const router = express.Router();

// Dashboard Stats
router.get('/stats', requireAuth, adminController.getStats);

// Plan Management
router.get('/plans', requireAuth, adminController.getPlans);
router.post('/plans', requireAuth, adminController.createPlan);

// M-Pesa Settings
router.post('/settings/mpesa', requireAuth, adminController.saveMpesaSettings);

// Router Management
router.post('/routers', requireAuth, adminController.createRouter);

module.exports = router;