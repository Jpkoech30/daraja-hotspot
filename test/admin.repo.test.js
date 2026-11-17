const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pool } = require('../src/config/db');
const adminRepo = require('../src/modules/admin/admin.repo');

test('router list includes the latest agent poll timestamp', async () => {
  const originalQuery = pool.query;
  const router = {
    id: 'router-poll-status-test',
    last_seen_at: '2026-11-17T00:00:00Z',
    last_poll_at: '2026-11-17T00:00:30Z'
  };
  pool.query = async (query) => {
    assert.match(query, /routers\.last_seen_at, routers\.last_poll_at/);
    assert.match(query, /AS transaction_count/);
    return { rows: [router] };
  };

  try {
    assert.deepEqual(await adminRepo.getRouters('tenant-poll-status-test'), [router]);
  } finally {
    pool.query = originalQuery;
  }
});

test('bulk router deletion queues remote uninstall jobs atomically', async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const ids = [
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222'
  ];
  const client = {
    async query(query, values) {
      statements.push({ query, values });
      if (query.startsWith('SELECT routers.id')) {
        assert.match(query, /routers\.tenant_id = \$1 AND routers\.id = ANY\(\$2::uuid\[\]\)/);
        assert.match(query, /FOR UPDATE/);
        return {
          rows: [
            { id: ids[0], name: 'Test A', has_transactions: false, uninstall_requested_at: null },
            { id: ids[1], name: 'Test B', has_transactions: false, uninstall_requested_at: null }
          ]
        };
      }
      return { rows: [] };
    },
    release() {}
  };
  pool.connect = async () => client;

  try {
    const result = await adminRepo.deleteRouters('tenant-1', ids);
    assert.deepEqual(result, {
      requestedCount: 2,
      alreadyPendingCount: 0,
      blockedRouters: []
    });
    assert.equal(statements[0].query, 'BEGIN');
    assert.deepEqual(statements[1].values, ['tenant-1', ids]);
    assert.equal(statements.filter(({ query }) => query.includes("SELECT $1, $2, 'UNINSTALL'")).length, 2);
    assert.equal(statements.some(({ query }) => query.startsWith('DELETE FROM routers')), false);
    assert.equal(statements.at(-1).query, 'COMMIT');
  } finally {
    pool.connect = originalConnect;
  }
});

test('bulk router deletion preserves the batch when any router has payment history', async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    async query(query) {
      statements.push(query);
      if (query.startsWith('SELECT routers.id')) {
        return {
          rows: [{
            id: '11111111-1111-1111-1111-111111111111',
            name: 'Used router',
            has_transactions: true,
            uninstall_requested_at: null
          }]
        };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  pool.connect = async () => client;

  try {
    const result = await adminRepo.deleteRouters(
      'tenant-1',
      ['11111111-1111-1111-1111-111111111111']
    );
    assert.deepEqual(result, {
      requestedCount: 0,
      alreadyPendingCount: 0,
      blockedRouters: ['Used router']
    });
    assert.ok(statements.includes('ROLLBACK'));
    assert.equal(statements.some(query => query.startsWith('DELETE FROM routers')), false);
  } finally {
    pool.connect = originalConnect;
  }
});

test('router list exposes remote uninstall state', async () => {
  const originalQuery = pool.query;
  let router;
  pool.query = async (query) => {
    assert.match(query, /routers\.uninstall_requested_at, routers\.uninstall_completed_at/);
    router = { id: 'router-uninstall-test', uninstall_requested_at: 'requested', uninstall_completed_at: null };
    return { rows: [router] };
  };

  try {
    assert.deepEqual(await adminRepo.getRouters('tenant-uninstall-test'), [router]);
  } finally {
    pool.query = originalQuery;
  }
});

test('router setup checkpoints are stored only for the matching active agent token', async () => {
  const originalQuery = pool.query;
  let queryValues;
  pool.query = async (query, values) => {
    assert.match(query, /SET setup_stage = \$2, setup_updated_at = NOW\(\)/);
    assert.match(query, /agent_token_hash = \$1 AND active = TRUE/);
    queryValues = values;
    return { rowCount: 1 };
  };

  try {
    assert.equal(await require('../src/modules/agents/agents.repo')
      .updateSetupStage('router-token-hash', 'install-file-downloaded'), 1);
    assert.deepEqual(queryValues, ['router-token-hash', 'install-file-downloaded']);
  } finally {
    pool.query = originalQuery;
  }
});
