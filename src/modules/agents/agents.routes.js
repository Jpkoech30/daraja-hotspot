const express = require('express');
const controller = require('./agents.controller');
const { verifyAgent } = require('../../middlewares/agentAuth');
const router = express.Router();

// express.text() allows us to read the raw string body from the MikroTik
router.post('/poll', express.text({ type: '*/*' }), verifyAgent, controller.poll);

module.exports = router;