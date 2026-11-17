process.env.ENCRYPTION_KEY = '00'.repeat(32);

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { pool } = require('../src/config/db');
const agentsController = require('../src/modules/agents/agents.controller');
const agentsService = require('../src/modules/agents/agents.service');

function createResponse() {
  return {
    statusCode: 200,
    contentType: '',
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    type(value) {
      this.contentType = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    }
  };
}

test('heartbeat records an authenticated active router without claiming jobs', async () => {
  const originalQuery = pool.query;
  const originalRecordHeartbeat = agentsService.recordHeartbeat;
  const token = 'router-heartbeat-test-token';
  const routerId = 'router-heartbeat-test-id';
  let recordedRouterId;

  pool.query = async (query, values) => {
    assert.match(query, /agent_token_hash = \$1 AND active = TRUE/);
    assert.deepEqual(values, [crypto.createHash('sha256').update(token).digest('hex')]);
    return { rows: [{ id: routerId }] };
  };
  agentsService.recordHeartbeat = async (id) => {
    recordedRouterId = id;
  };

  try {
    const response = createResponse();
    await agentsController.heartbeat({ get: () => token }, response, assert.fail);

    assert.equal(recordedRouterId, routerId);
    assert.equal(response.statusCode, 200);
    assert.equal(response.contentType, 'text/plain');
    assert.equal(response.body, 'OK');
  } finally {
    pool.query = originalQuery;
    agentsService.recordHeartbeat = originalRecordHeartbeat;
  }
});

test('heartbeat rejects invalid router tokens', async () => {
  const originalQuery = pool.query;
  const originalRecordHeartbeat = agentsService.recordHeartbeat;
  let recorded = false;
  pool.query = async () => ({ rows: [] });
  agentsService.recordHeartbeat = async () => {
    recorded = true;
  };

  try {
    const response = createResponse();
    await agentsController.heartbeat({ get: () => 'invalid-router-token' }, response, assert.fail);

    assert.equal(response.statusCode, 401);
    assert.equal(response.body, 'Unauthorized');
    assert.equal(recorded, false);
  } finally {
    pool.query = originalQuery;
    agentsService.recordHeartbeat = originalRecordHeartbeat;
  }
});

test('configure accepts plain-text gateway payloads from the router agent', async () => {
  const originalUpdateRouterGateway = require('../src/modules/admin/admin.service').updateRouterGateway;
  let captured = null;
  require('../src/modules/admin/admin.service').updateRouterGateway = async (token, gateway) => {
    captured = { token, gateway };
    return { ok: true };
  };

  try {
    const response = createResponse();
    await agentsController.configure({ get: () => 'router-config-token', body: ' 192.168.88.1 ' }, response, assert.fail);

    assert.deepEqual(captured, {
      token: 'router-config-token',
      gateway: '192.168.88.1'
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'OK');
  } finally {
    require('../src/modules/admin/admin.service').updateRouterGateway = originalUpdateRouterGateway;
  }
});

test('discovery passes the selected LAN interface into the generated setup script', async () => {
  const adminService = require('../src/modules/admin/admin.service');
  const originalGenerateDiscovery = adminService.generateRouterDiscoveryScript;
  let received;
  adminService.generateRouterDiscoveryScript = async (...values) => {
    received = values;
    return 'script';
  };

  try {
    const response = createResponse();
    await agentsController.discover({
      get: () => 'router-discovery-token',
      query: { interface: 'ether3' }
    }, response, assert.fail);

    assert.deepEqual(received, ['router-discovery-token', 'ether3']);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'script');
  } finally {
    adminService.generateRouterDiscoveryScript = originalGenerateDiscovery;
  }
});

test('setup progress accepts an authenticated installer checkpoint', async () => {
  const originalUpdateSetupStage = agentsService.updateSetupStage;
  const token = 'router-setup-progress-token';
  let received;
  agentsService.updateSetupStage = async (tokenHash, stage) => {
    received = { tokenHash, stage };
    return 1;
  };

  try {
    const response = createResponse();
    await agentsController.setupStatus({
      get: () => token,
      body: 'install-file-downloaded'
    }, response, assert.fail);

    assert.deepEqual(received, {
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      stage: 'install-file-downloaded'
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'OK');
  } finally {
    agentsService.updateSetupStage = originalUpdateSetupStage;
  }
});
