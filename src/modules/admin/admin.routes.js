const express = require('express');
const adminController = require('./admin.controller');
const { requireAuth } = require('../../middlewares/auth.middleware'); 

const router = express.Router();

router.use(requireAuth);

// Dashboard Stats
router.get('/stats', adminController.getStats);
router.get('/overview', adminController.getDashboardOverview);

// Plan Management
router.get('/plans', adminController.getPlans);
router.post('/plans', adminController.createPlan);
router.put('/plans/:planId', adminController.updatePlan);
router.delete('/plans/:planId', adminController.archivePlan);

// M-Pesa Settings
router.get('/settings/mpesa', adminController.getMpesaSettings);
router.post('/settings/mpesa', adminController.saveMpesaSettings);
router.delete('/settings/mpesa', adminController.clearMpesaSettings);

// Router Management
router.get('/routers', adminController.getRouters);
router.post('/routers', adminController.createRouter);
router.put('/routers/:routerId', adminController.updateRouter);
router.delete('/routers/bulk', adminController.deleteRouters);
router.delete('/routers/:routerId', adminController.archiveRouter);

module.exports = router;