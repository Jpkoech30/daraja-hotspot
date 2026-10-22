const express = require('express');
const checkoutController = require('./checkout.controller');
const router = express.Router();

// POST /api/portal/checkout
router.post('/', checkoutController.checkout);
router.get('/status/:checkoutId', checkoutController.getStatus);

module.exports = router;