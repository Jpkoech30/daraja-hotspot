const express = require('express');
const checkoutController = require('./checkout.controller');
const router = express.Router();

// POST /api/portal/checkout
router.post('/', checkoutController.checkout);

module.exports = router;