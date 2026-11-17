const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pool } = require('../src/config/db');
const agentsRepo = require('../src/modules/agents/agents.repo');
const agentsService = require('../src/modules/agents/agents.service');

test('recordPoll persists a poll timestamp separately from heartbeat-only check-ins', async () => {
  const originalQuery = pool.query;
  let queryText;
  let queryValues;
  pool.query = async (query, values) => {
    queryText = query;
    queryValues = values;
    return { rowCount: 1 };
  };

  try {
    await agentsRepo.recordPoll('router-poll-test');

    assert.match(queryText, /last_poll_at = NOW\(\)/);
    assert.match(queryText, /last_seen_at = NOW\(\)/);
    assert.deepEqual(queryValues, ['router-poll-test']);
  } finally {
    pool.query = originalQuery;
  }
});

test('processPoll records the poll and returns NONE when there are no queued jobs', async () => {
  const originalRecordPoll = agentsRepo.recordPoll;
  const originalClaimNextJob = agentsRepo.claimNextJob;
  let recordedRouterId;
  agentsRepo.recordPoll = async (routerId) => {
    recordedRouterId = routerId;
  };
  agentsRepo.claimNextJob = async () => null;

  try {
    assert.equal(await agentsService.processPoll('router-poll-test', ''), 'NONE');
    assert.equal(recordedRouterId, 'router-poll-test');
  } finally {
    agentsRepo.recordPoll = originalRecordPoll;
    agentsRepo.claimNextJob = originalClaimNextJob;
  }
});

test('processPoll ignores malformed job IDs and still serves the next poll', async () => {
  const originalRecordPoll = agentsRepo.recordPoll;
  const originalMarkJobResult = agentsRepo.markJobResult;
  const originalClaimNextJob = agentsRepo.claimNextJob;
  let markJobResultCalled = false;
  let claimCalled = false;
  agentsRepo.recordPoll = async () => {};
  agentsRepo.markJobResult = async () => {
    markJobResultCalled = true;
    throw new Error('must not send invalid UUID to PostgreSQL');
  };
  agentsRepo.claimNextJob = async () => {
    claimCalled = true;
    return null;
  };

  try {
    assert.equal(await agentsService.processPoll('router-poll-test', 'N:SUCCESS:'), 'NONE');
    assert.equal(markJobResultCalled, false);
    assert.equal(claimCalled, true);
  } finally {
    agentsRepo.recordPoll = originalRecordPoll;
    agentsRepo.markJobResult = originalMarkJobResult;
    agentsRepo.claimNextJob = originalClaimNextJob;
  }
});

test('processPoll accepts a valid UUID job result', async () => {
  const originalRecordPoll = agentsRepo.recordPoll;
  const originalMarkJobResult = agentsRepo.markJobResult;
  const originalClaimNextJob = agentsRepo.claimNextJob;
  const jobId = '123e4567-e89b-12d3-a456-426614174000';
  let received;
  agentsRepo.recordPoll = async () => {};
  agentsRepo.markJobResult = async (...values) => {
    received = values;
    return 1;
  };
  agentsRepo.claimNextJob = async () => null;

  try {
    assert.equal(await agentsService.processPoll('router-poll-test', `${jobId}:FAILED:command: failed`), 'NONE');
    assert.deepEqual(received, [jobId, false, 'command: failed', 'router-poll-test']);
  } finally {
    agentsRepo.recordPoll = originalRecordPoll;
    agentsRepo.markJobResult = originalMarkJobResult;
    agentsRepo.claimNextJob = originalClaimNextJob;
  }
});

test('processPoll acknowledges a completed uninstall before normal job claiming', async () => {
  const originalRecordPoll = agentsRepo.recordPoll;
  const originalMarkJobResult = agentsRepo.markJobResult;
  const originalClaimNextJob = agentsRepo.claimNextJob;
  const jobId = '123e4567-e89b-12d3-a456-426614174000';
  agentsRepo.recordPoll = async () => {};
  agentsRepo.markJobResult = async () => ({ action: 'UNINSTALL' });
  agentsRepo.claimNextJob = async () => {
    throw new Error('Uninstall acknowledgement must not claim another job');
  };

  try {
    assert.equal(
      await agentsService.processPoll('router-poll-test', `${jobId}:SUCCESS:`, false),
      'UNINSTALL_COMPLETE'
    );
    assert.equal(
      await agentsService.processPoll('router-poll-test', '', true),
      'UNINSTALL_COMPLETE'
    );
  } finally {
    agentsRepo.recordPoll = originalRecordPoll;
    agentsRepo.markJobResult = originalMarkJobResult;
    agentsRepo.claimNextJob = originalClaimNextJob;
  }
});

test('processPoll returns a claimed uninstall instruction', async () => {
  const originalRecordPoll = agentsRepo.recordPoll;
  const originalClaimNextJob = agentsRepo.claimNextJob;
  const jobId = '123e4567-e89b-12d3-a456-426614174000';
  agentsRepo.recordPoll = async () => {};
  agentsRepo.claimNextJob = async () => ({ id: jobId, action: 'UNINSTALL', payload: {} });

  try {
    assert.equal(
      await agentsService.processPoll('router-poll-test', ''),
      `${jobId}:UNINSTALL:`
    );
  } finally {
    agentsRepo.recordPoll = originalRecordPoll;
    agentsRepo.claimNextJob = originalClaimNextJob;
  }
});

test('markJobResult confirms remote uninstall atomically and requeues failures', async () => {
  const originalConnect = pool.connect;
  const jobId = '123e4567-e89b-12d3-a456-426614174000';
  const statements = [];
  const client = {
    async query(query, values) {
      statements.push({ query, values });
      if (query.startsWith('UPDATE provisioning_jobs')) {
        return { rows: [{ action: 'UNINSTALL', payload: {} }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  pool.connect = async () => client;

  try {
    assert.deepEqual(
      await agentsRepo.markJobResult(jobId, true, '', 'router-uninstall-test'),
      { action: 'UNINSTALL' }
    );
    assert.match(statements[1].query, /action = 'UNINSTALL' AND \$2 = FALSE THEN 'PENDING'/);
    assert.match(statements[2].query, /SET uninstall_completed_at = NOW\(\)/);
    assert.equal(statements.at(-1).query, 'COMMIT');
  } finally {
    pool.connect = originalConnect;
  }
});

test('completeRouterUninstall only deletes a router after confirmed cleanup', async () => {
  const originalQuery = pool.query;
  let queryText;
  pool.query = async (query, values) => {
    queryText = query;
    assert.deepEqual(values, ['router-uninstall-test']);
    return { rowCount: 1 };
  };

  try {
    assert.equal(await agentsRepo.completeRouterUninstall('router-uninstall-test'), 1);
    assert.match(queryText, /uninstall_requested_at IS NOT NULL/);
    assert.match(queryText, /uninstall_completed_at IS NOT NULL/);
    assert.match(queryText, /action = 'UNINSTALL'/);
    assert.match(queryText, /status = 'SUCCESS'/);
  } finally {
    pool.query = originalQuery;
  }
});

test('setup progress only accepts known installer stages', async () => {
  const originalUpdateSetupStage = agentsRepo.updateSetupStage;
  let received;
  agentsRepo.updateSetupStage = async (...values) => {
    received = values;
    return 1;
  };

  try {
    assert.equal(await agentsService.updateSetupStage('router-hash', 'install-file-downloaded'), 1);
    assert.deepEqual(received, ['router-hash', 'install-file-downloaded']);
    await assert.rejects(
      agentsService.updateSetupStage('router-hash', 'arbitrary text'),
      /Invalid router setup stage/
    );
  } finally {
    agentsRepo.updateSetupStage = originalUpdateSetupStage;
  }
});
