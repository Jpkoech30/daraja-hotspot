const express = require('express');
const controller = require('./agents.controller');
const router = express.Router();

router.post('/poll', express.text({ type: '*/*' }), controller.poll);

module.exports = router;