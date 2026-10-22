const agentsRepo = require('./agents.repo');

exports.processPoll = async (routerId, bodyText) => {
  // 1. Update heartbeat (router is alive)
  await agentsRepo.updateHeartbeat(routerId);

  // 2. Check if the router is reporting the result of a previous job
  // Format expected: "<jobId>:<SUCCESS|FAILED>:<error_msg>"
  if (bodyText && bodyText.includes(':')) {
    const [jobId, status, ...errParts] = bodyText.split(':');
    const errorMsg = errParts.join(':');
    
    if (jobId && (status === 'SUCCESS' || status === 'FAILED')) {
      const updatedJobs = await agentsRepo.markJobResult(
        jobId,
        status === 'SUCCESS',
        errorMsg,
        routerId
      );
      if (updatedJobs) {
        console.log(`[Agent] Job ${jobId} reported as ${status}`);
      }
    }
  }

  // 3. Try to claim a new job
  const job = await agentsRepo.claimNextJob(routerId);

  if (!job) {
    return 'NONE';
  }

  // 4. Format the new job for the MikroTik
  const p = job.payload;
  
  if (job.action === 'CREATE_USER') {
    return `${job.id}:CREATE_USER:${p.username}:${p.password}:${p.profile}`;
  } 
  
  if (job.action === 'DISABLE_USER' || job.action === 'ENABLE_USER') {
    return `${job.id}:${job.action}:${p.username}`;
  }

  return 'NONE';
};