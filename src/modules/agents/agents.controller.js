const crypto = require('crypto');
const { pool } = require('../../config/db');
const agentsService = require('./agents.service');

exports.poll = async (req, res, next) => {
  try {
    const token = req.get('X-Agent-Token');
    if (!token) {
      return res.status(401).type('text/plain').send('Unauthorized');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows } = await pool.query(
      'SELECT id FROM routers WHERE agent_token_hash = $1 LIMIT 1',
      [tokenHash]
    );
    if (!rows.length) {
      return res.status(401).type('text/plain').send('Unauthorized');
    }

    const routerId = rows[0].id;
    const bodyText = typeof req.body === 'string' ? req.body : '';
    const responseText = await agentsService.processPoll(routerId, bodyText);

    return res.status(200).type('text/plain').send(responseText);
  } catch (error) {
    return next(error);
  }
};