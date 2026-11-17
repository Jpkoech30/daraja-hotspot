const agentsRepo = require('./agents.repo');
const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.recordHeartbeat = async (routerId) => {
  await agentsRepo.updateHeartbeat(routerId);
};

const routerSetupStages = new Set([
  'discovery-started',
  'dhcp-client-scan-complete',
  'default-route-scan-started',
  'default-route-scan-complete',
  'bridge-scan-complete',
  'ethernet-scan-complete',
  'lan-interface-selected',
  'gateway-selected',
  'lan-detected',
  'install-download-started',
  'install-file-downloaded',
  'install-import-started',
  'installer-started',
  'heartbeat-install-started',
  'heartbeat-installed',
  'hotspot-configured',
  'gateway-registered',
  'poller-install-started',
  'poller-installed',
  'complete'
]);

exports.updateSetupStage = async (agentTokenHash, stage) => {
  if (!routerSetupStages.has(stage)) {
    throw new Error('Invalid router setup stage');
  }
  return agentsRepo.updateSetupStage(agentTokenHash, stage);
};

exports.processPoll = async (routerId, bodyText, uninstallCompleted = false) => {
  // 1. Record a poll separately from heartbeat-only check-ins.
  await agentsRepo.recordPoll(routerId);

  // 2. Check if the router is reporting the result of a previous job
  // Format expected: "<jobId>:<SUCCESS|FAILED>:<error_msg>"
  if (typeof bodyText === 'string' && bodyText.includes(':')) {
    const [rawJobId, status, ...errParts] = bodyText.trim().split(':');
    const jobId = rawJobId.trim();
    const errorMsg = errParts.join(':');
    
    if (jobId && (status === 'SUCCESS' || status === 'FAILED')) {
      if (jobIdPattern.test(jobId)) {
        const updatedJob = await agentsRepo.markJobResult(
          jobId,
          status === 'SUCCESS',
          errorMsg,
          routerId
        );
        if (updatedJob) {
          console.log(`[Agent] Job ${jobId} reported as ${status}`);
          if (updatedJob.action === 'UNINSTALL' && status === 'SUCCESS') {
            return 'UNINSTALL_COMPLETE';
          }
        }
      } else {
        console.warn(
          `[Agent] Ignoring malformed job result with an invalid job ID (length ${jobId.length})`
        );
      }
    }
  }

  if (uninstallCompleted) return 'UNINSTALL_COMPLETE';

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

  if (job.action === 'UNINSTALL') {
    return `${job.id}:UNINSTALL:`;
  }

  return 'NONE';
};

exports.completeRouterUninstall = async (routerId) => {
  const deleted = await agentsRepo.completeRouterUninstall(routerId);
  if (!deleted) throw new Error('Router uninstall is not confirmed');
  return true;
};