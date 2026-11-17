const express = require('express');
const controller = require('./agents.controller');
const router = express.Router();

router.get('/hotspot-login', controller.hotspotLogin);
router.get('/discover', controller.discover);
router.get('/install', controller.install);
router.post('/configure', express.text({ type: '*/*' }), controller.configure);
router.post('/setup-status', express.text({ type: '*/*' }), controller.setupStatus);
router.post('/uninstall-complete', express.text({ type: '*/*' }), controller.uninstallComplete);
router.post('/heartbeat', controller.heartbeat);
router.post('/poll', express.text({ type: '*/*' }), controller.poll);

module.exports = router;