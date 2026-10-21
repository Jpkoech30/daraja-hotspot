// src/modules/agents/agents.controller.js
const agentsService = require('./agents.service');
const { pool } = require('../../config/db'); // Import pool to look up the token

exports.poll = async (req, res, next) => {
  try {
    // 1. The router sends a token in the headers (e.g., Authorization: Bearer rt_live_xxxx)
    // For local testing, we will check the body, but in production, use headers!
    const agentToken = req.body.agentToken; 
    
    if (!agentToken) {
      return res.status(401).json({ error: 'Unauthorized: Missing agent token' });
    }

    // 2. Look up the router by the token (In a real app, you would hash the incoming token first!)
    const routerQuery = `SELECT id FROM routers WHERE agent_token_hash = $1`;
    const routerResult = await pool.query(routerQuery, [agentToken]);

    if (routerResult.rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // 3. This is the REAL, beautiful UUID fetched from the database
    const routerId = routerResult.rows[0].id;
    
    // 4. Process the job
    const lastJobResult = req.body.lastJobResult; 
    const job = await agentsService.handlePoll(routerId, lastJobResult);

    if (!job) {
      return res.status(200).json({ job: null, message: 'No pending jobs' });
    }

    res.status(200).json({ job });
  } catch (error) {
    next(error);
  }
};