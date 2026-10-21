// src/modules/agents/agents.routes.js
const express = require('express');
const agentsController = require('./agents.controller');
const router = express.Router();

// POST /api/agents/poll
router.post('/poll', agentsController.poll);

module.exports = router;