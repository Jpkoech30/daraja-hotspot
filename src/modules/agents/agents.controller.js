const crypto = require('crypto');
const { pool } = require('../../config/db');
const agentsService = require('./agents.service');
const adminService = require('../admin/admin.service');

exports.hotspotLogin = async (req, res, next) => {
  const token = req.get('X-Agent-Token');
  if (!token) return res.status(401).type('text/plain').send('Unauthorized');

  try {
    const html = await adminService.generateHotspotLoginPage(token, req.query.routerId);
    return res.status(200).type('html').send(html);
  } catch (error) {
    if (error.message === 'Router not found') {
      return res.status(401).type('text/plain').send('Unauthorized');
    }
    return next(error);
  }
};

exports.install = async (req, res, next) => {
  const token = req.get('X-Agent-Token');
  if (!token) return res.status(401).type('text/plain').send('Unauthorized');

  try {
    const script = await adminService.generateRouterInstallScript(
      token,
      req.query.interface,
      req.query.gateway
    );
    return res.status(200).type('text/plain').send(script);
  } catch (error) {
    if (error.message === 'Router not found') {
      return res.status(401).type('text/plain').send('Unauthorized');
    }
    if (error.message.startsWith('Router hotspot')
        || error.message === 'Router setup cannot include a bundle profile with invalid characters') {
      return res.status(400).type('text/plain').send(error.message);
    }
    return next(error);
  }
};

exports.discover = async (req, res, next) => {
  const token = req.get('X-Agent-Token');
  if (!token) return res.status(401).type('text/plain').send('Unauthorized');

  try {
    const script = await adminService.generateRouterDiscoveryScript(
      token,
      req.query.interface
    );
    return res.status(200).type('text/plain').send(script);
  } catch (error) {
    if (error.message === 'Router not found') {
      return res.status(401).type('text/plain').send('Unauthorized');
    }
    if (error.message === 'Router hotspot interface name is invalid') {
      return res.status(400).type('text/plain').send(error.message);
    }
    return next(error);
  }
};

exports.configure = async (req, res, next) => {
  const token = req.get('X-Agent-Token');
  if (!token) return res.status(401).type('text/plain').send('Unauthorized');

  try {
    const gatewayValue = typeof req.body === 'string' ? req.body.trim() : '';
    await adminService.updateRouterGateway(token, gatewayValue);
    return res.status(200).type('text/plain').send('OK');
  } catch (error) {
    if (error.message === 'Router not found') {
      return res.status(401).type('text/plain').send('Unauthorized');
    }
    if (error.message.startsWith('Router hotspot gateway')) {
      return res.status(400).type('text/plain').send(error.message);
    }
    return next(error);
  }
};

exports.setupStatus = async (req, res, next) => {
  const token = req.get('X-Agent-Token');
  if (!token) return res.status(401).type('text/plain').send('Unauthorized');

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const updated = await agentsService.updateSetupStage(tokenHash, req.body);
    if (!updated) return res.status(401).type('text/plain').send('Unauthorized');
    return res.status(200).type('text/plain').send('OK');
  } catch (error) {
    if (error.message === 'Invalid router setup stage') {
      return res.status(400).type('text/plain').send(error.message);
    }
    return next(error);
  }
};

exports.heartbeat = async (req, res, next) => {
  try {
    const token = req.get('X-Agent-Token');
    if (!token) {
      return res.status(401).type('text/plain').send('Unauthorized');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows } = await pool.query(
      'SELECT id FROM routers WHERE agent_token_hash = $1 AND active = TRUE LIMIT 1',
      [tokenHash]
    );
    if (!rows.length) {
      return res.status(401).type('text/plain').send('Unauthorized');
    }

    await agentsService.recordHeartbeat(rows[0].id);
    return res.status(200).type('text/plain').send('OK');
  } catch (error) {
    return next(error);
  }
};

exports.poll = async (req, res, next) => {
  try {
    const token = req.get('X-Agent-Token');
    if (!token) {
      return res.status(401).type('text/plain').send('Unauthorized');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows } = await pool.query(
      `SELECT id, uninstall_completed_at
       FROM routers
       WHERE agent_token_hash = $1 AND active = TRUE
       LIMIT 1`,
      [tokenHash]
    );
    if (!rows.length) {
      return res.status(401).type('text/plain').send('Unauthorized');
    }

    const routerId = rows[0].id;
    const bodyText = typeof req.body === 'string' ? req.body : '';
    const responseText = await agentsService.processPoll(
      routerId,
      bodyText,
      Boolean(rows[0].uninstall_completed_at)
    );

    return res.status(200).type('text/plain').send(responseText);
  } catch (error) {
    return next(error);
  }
};

exports.uninstallComplete = async (req, res, next) => {
  try {
    const token = req.get('X-Agent-Token');
    if (!token) return res.status(401).type('text/plain').send('Unauthorized');

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows } = await pool.query(
      'SELECT id FROM routers WHERE agent_token_hash = $1 AND active = TRUE LIMIT 1',
      [tokenHash]
    );
    if (!rows.length) return res.status(401).type('text/plain').send('Unauthorized');

    await agentsService.completeRouterUninstall(rows[0].id);
    return res.status(200).type('text/plain').send('OK');
  } catch (error) {
    if (error.message === 'Router uninstall is not confirmed') {
      return res.status(409).type('text/plain').send(error.message);
    }
    return next(error);
  }
};