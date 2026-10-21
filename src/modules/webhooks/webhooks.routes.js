// src/modules/webhooks/webhooks.routes.js
const express = require('express');
const webhooksController = require('./webhooks.controller');
const router = express.Router();

// POST /api/webhooks/mpesa
router.post('/mpesa', webhooksController.mpesaCallback);

module.exports = router;