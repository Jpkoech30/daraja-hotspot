// src/modules/agents/agents.service.js
const agentsRepo = require('./agents.repo');

exports.handlePoll = async (routerId, lastJobResult) => {
  // 1. Mark the router as online
  await agentsRepo.updateRouterHeartbeat(routerId);

  // 2. If the router is reporting the result of its previous job, save it
  if (lastJobResult && lastJobResult.jobId) {
    await agentsRepo.completeJob(
      lastJobResult.jobId, 
      lastJobResult.success, 
      lastJobResult.error || null
    );
  }

  // 3. Try to claim a new job
  const nextJob = await agentsRepo.claimNextJob(routerId);

  return nextJob;
};