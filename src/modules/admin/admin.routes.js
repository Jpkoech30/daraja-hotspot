// src/modules/admin/admin.routes.js
const express = require('express');
const adminController = require('./admin.controller');
const { requireAuth } = require('../../middlewares/auth.middleware'); // Import middleware

const router = express.Router();

// Apply the auth middleware to ALL routes in this file
router.use(requireAuth);

// Dashboard Stats
router.get('/stats', adminController.getStats);

// Plan Management
router.get('/plans', adminController.getPlans);
router.post('/plans', adminController.createPlan);

// M-Pesa Settings
router.post('/settings/mpesa', adminController.saveMpesaSettings);

module.exports = router;