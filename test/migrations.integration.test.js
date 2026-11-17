const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const { after, test } = require('node:test');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const databaseUrl = process.env.TEST_DATABASE_URL;
const createdDatabases = [];
let adminPool;

after(async () => {
  if (!adminPool) return;
  try {
    for (const database of createdDatabases) {
      await adminPool.query(
        `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`
      );
    }
  } finally {
    await adminPool.end();
  }
});

test('fresh production and development databases migrate cleanly and rerun safely', {
  skip: !databaseUrl && 'Set TEST_DATABASE_URL to run PostgreSQL migration integration tests'
}, async () => {
  assert.ok(databaseUrl, 'TEST_DATABASE_URL is required');
  adminPool = new Pool({ connectionString: databaseUrl });

  const productionDb = await createTestDatabase('prod');
  const developmentDb = await createTestDatabase('dev');

  await runMigrations(productionDb, 'production');
  await runMigrations(productionDb, 'production');
  await verifyDatabase(productionDb, false);
  await verifyIspDatabaseCrud(productionDb);

  await runMigrations(developmentDb, 'development');
  await runMigrations(developmentDb, 'development');
  await verifyDatabase(developmentDb, true);
});

async function verifyIspDatabaseCrud(url) {
  process.env.DATABASE_URL = url;
  process.env.ENCRYPTION_KEY = '31'.repeat(32);
  process.env.JWT_SECRET = 'migration-integration-test-secret';
  process.env.BACKEND_URL = 'https://isp.example.test';

  const { pool } = require('../src/config/db');
  const adminRepo = require('../src/modules/admin/admin.repo');
  const adminService = require('../src/modules/admin/admin.service');
  const authService = require('../src/modules/auth/auth.service');
  const emailService = require('../src/services/email.service');
  const checkoutRepo = require('../src/modules/checkout/checkout.repo');
  const webhooksService = require('../src/modules/webhooks/webhooks.service');
  const agentsService = require('../src/modules/agents/agents.service');

  const originalSendVerificationEmail = emailService.sendVerificationEmail;
  const originalEnsureEmailConfigured = emailService.ensureConfigured;
  let verificationCode;
  emailService.ensureConfigured = () => {};
  emailService.sendVerificationEmail = async (_email, _name, code) => {
    verificationCode = code;
  };

  try {
    const { rows: tenantRows } = await pool.query(
      `INSERT INTO tenants (name, email)
       VALUES ('Integration ISP', $1)
       RETURNING id`,
      [`integration-${crypto.randomUUID()}@example.test`]
    );
    const tenantId = tenantRows[0].id;
    const { rows: otherTenantRows } = await pool.query(
      `INSERT INTO tenants (name, email)
       VALUES ('Other Integration ISP', $1)
       RETURNING id`,
      [`other-${crypto.randomUUID()}@example.test`]
    );
    const otherTenantId = otherTenantRows[0].id;

    const registrationEmail = `  NEW-${crypto.randomUUID()}@example.test  `;
    const registration = await authService.register(
      'New ISP',
      registrationEmail,
      'integration-password-long-enough'
    );
    const normalizedRegistrationEmail = registrationEmail.trim().toLowerCase();
    assert.match(registration.message, /Check your email/);
    await assert.rejects(
      authService.login(normalizedRegistrationEmail, 'integration-password-long-enough'),
      /Email not verified/
    );
    await authService.verifyEmail(normalizedRegistrationEmail, verificationCode);
    await assert.rejects(
      authService.verifyEmail(normalizedRegistrationEmail, verificationCode),
      /invalid, expired, or has too many attempts/
    );
    const registrationLogin = await authService.login(
      normalizedRegistrationEmail,
      'integration-password-long-enough'
    );
    assert.ok(registrationLogin.tenant.id);
    await assert.rejects(
      authService.register(
        'Duplicate ISP',
        normalizedRegistrationEmail.toUpperCase(),
        'integration-password-long-enough'
      ),
      /Email already registered/
    );

    const attemptsEmail = `attempts-${crypto.randomUUID()}@example.test`;
    await authService.register(
      'Attempt Limit ISP',
      attemptsEmail,
      'integration-password-long-enough'
    );
    const invalidCode = verificationCode === '00000000' ? '00000001' : '00000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(
        authService.verifyEmail(attemptsEmail, invalidCode),
        /invalid, expired, or has too many attempts/
      );
    }
    const { rows: attemptRows } = await pool.query(
      `SELECT email_verification_attempts FROM tenants WHERE LOWER(email) = $1`,
      [attemptsEmail]
    );
    assert.equal(attemptRows[0].email_verification_attempts, 5);
    await assert.rejects(
      authService.verifyEmail(attemptsEmail, invalidCode),
      /invalid, expired, or has too many attempts/
    );
    await authService.resendVerificationEmail(attemptsEmail);
    const { rows: resetAttemptRows } = await pool.query(
      `SELECT email_verification_attempts FROM tenants WHERE LOWER(email) = $1`,
      [attemptsEmail]
    );
    assert.equal(resetAttemptRows[0].email_verification_attempts, 0);
    await authService.verifyEmail(attemptsEmail, verificationCode);

    const plan = await adminService.createPlan(tenantId, {
      name: 'One hour',
      price: '20',
      durationMin: '60',
      profile: 'hourly'
    });
    assert.equal(plan.active, true);
    assert.deepEqual(await adminRepo.getPlans(otherTenantId), []);

    const updatedPlan = await adminService.updatePlan(tenantId, plan.id, {
      name: 'Two hours',
      price: 30,
      durationMin: 120,
      profile: 'two-hours'
    });
    assert.equal(updatedPlan.name, 'Two hours');
    assert.deepEqual(await adminService.archivePlan(tenantId, plan.id), {
      id: plan.id,
      active: false
    });
    const reactivatedPlan = await adminService.updatePlan(tenantId, plan.id, {
      name: 'Two hours',
      price: 30,
      durationMin: 120,
      profile: 'two-hours',
      active: true
    });
    assert.equal(reactivatedPlan.active, true);

    const routerResult = await adminService.generateRouterScript(
      tenantId, 'Integration Router'
    );
    const routerId = routerResult.routerId;
    const routerToken = routerResult.script.match(/X-Agent-Token: (rt_[a-f0-9]+)/)[1];
    assert.equal(routerResult.script.includes('\n'), false);
    const routerInstallScript = await adminService.generateRouterInstallScript(
      routerToken, 'bridge', '192.168.88.1'
    );
    assert.match(routerInstallScript, /\/ip hotspot add name="daraja-hotspot-server"/);
    assert.match(routerInstallScript, /\/system script run daraja-agent-poll/);
    assert.equal((await adminService.getRouters(tenantId)).length, 1);
    const updatedRouter = await adminService.updateRouter(tenantId, routerId, {
      name: 'Updated Integration Router',
      localIp: '10.0.0.1'
    });
    assert.equal(updatedRouter.name, 'Updated Integration Router');
    assert.equal(await checkoutRepo.getActiveRouter(routerId, tenantId) !== undefined, true);
    await adminService.archiveRouter(tenantId, routerId);
    assert.equal(await checkoutRepo.getActiveRouter(routerId, tenantId), undefined);
    await adminService.updateRouter(tenantId, routerId, {
      name: 'Updated Integration Router',
      localIp: '10.0.0.1',
      active: true
    });

    await adminService.saveMpesaSettings(
      tenantId, '174379', 'consumer-key', 'consumer-secret', 'passkey'
    );
    assert.equal((await adminService.getMpesaSettings(tenantId)).configured, true);
    await adminService.clearMpesaSettings(tenantId);
    assert.equal((await adminService.getMpesaSettings(tenantId)).configured, false);

    const checkoutId = `integration-${crypto.randomUUID()}`;
    await checkoutRepo.createTransaction(
      tenantId,
      routerId,
      plan.id,
      checkoutId,
      '254700000000',
      30,
      120,
      'two-hours',
      'AA:BB:CC:DD:EE:FF'
    );

    await webhooksService.processMpesaCallback({
      Body: {
        stkCallback: {
          CheckoutRequestID: checkoutId,
          ResultCode: 0,
          CallbackMetadata: {
            Item: [{ Name: 'MpesaReceiptNumber', Value: 'TESTRECEIPT1234' }]
          }
        }
      }
    });

    const jobResponse = await agentsService.processPoll(routerId, '');
    const jobId = jobResponse.split(':')[0];
    assert.match(jobResponse, new RegExp(`^${jobId}:CREATE_USER:u_TESTRECEIPT1234:`));
    assert.equal(await agentsService.processPoll(routerId, `${jobId}:SUCCESS:`), 'NONE');

    const { rows: transactionRows } = await pool.query(
      `SELECT status, provider, plan_duration_min, plan_mikrotik_profile
       FROM transactions WHERE checkout_id = $1`,
      [checkoutId]
    );
    assert.deepEqual(transactionRows[0], {
      status: 'SUCCESS',
      provider: 'MPESA',
      plan_duration_min: 120,
      plan_mikrotik_profile: 'two-hours'
    });

    const { rows: userRows } = await pool.query(
      `SELECT tenant_id, router_id, username, mac_address, plan_id
       FROM hotspot_users WHERE router_id = $1`,
      [routerId]
    );
    assert.equal(userRows.length, 1);
    assert.equal(userRows[0].tenant_id, tenantId);
    assert.equal(userRows[0].username, 'u_TESTRECEIPT1234');
    assert.equal(userRows[0].mac_address, 'AA:BB:CC:DD:EE:FF');
    assert.equal(userRows[0].plan_id, plan.id);

    const otherPlan = await adminService.createPlan(otherTenantId, {
      name: 'Other tenant plan',
      price: 500,
      durationMin: 60,
      profile: 'other-plan'
    });
    const otherRouter = await adminService.generateRouterScript(
      otherTenantId,
      'Other tenant router',
      '192.168.88.2',
      'bridge'
    );
    await checkoutRepo.createTransaction(
      otherTenantId,
      otherRouter.routerId,
      otherPlan.id,
      `other-${crypto.randomUUID()}`,
      '254711111111',
      500,
      60,
      'other-plan',
      null
    );

    const dashboardOverview = await adminService.getDashboardOverview(tenantId, 30);
    assert.equal(Number(dashboardOverview.payments.revenue), 30);
    assert.equal(dashboardOverview.payments.successful_payments, 1);
    assert.equal(dashboardOverview.payments.pending_payments, 0);
    assert.equal(dashboardOverview.dailyRevenue.length, 30);
    assert.equal(dashboardOverview.provisioning.successful, 1);
    assert.ok(dashboardOverview.pings.received_24h >= 2);
    assert.ok(dashboardOverview.pings.received_1h >= 2);
    assert.equal(dashboardOverview.pings.online_routers, 1);
    assert.ok(dashboardOverview.pings.last_ping_at);
    const [routerWithPings] = await adminService.getRouters(tenantId);
    assert.ok(routerWithPings.pings_last_hour >= 2);
    assert.equal(routerWithPings.health, 'ONLINE');
    assert.equal(dashboardOverview.recentPayments.length, 1);
    assert.equal(dashboardOverview.recentPayments[0].phone, '••••0000');
    assert.equal(JSON.stringify(dashboardOverview).includes('254700000000'), false);
    assert.equal(JSON.stringify(dashboardOverview).includes('raw_callback'), false);
    assert.equal(JSON.stringify(dashboardOverview).includes('TESTRECEIPT1234'), false);
    const otherOverview = await adminService.getDashboardOverview(otherTenantId, 30);
    assert.equal(Number(otherOverview.payments.revenue), 0);
    assert.equal(otherOverview.payments.pending_payments, 1);
    assert.equal(otherOverview.provisioning.successful, 0);
  } finally {
    emailService.sendVerificationEmail = originalSendVerificationEmail;
    emailService.ensureConfigured = originalEnsureEmailConfigured;
    await pool.end();
  }
}

async function createTestDatabase(label) {
  const database = `daraja_migration_test_${label}_${crypto.randomBytes(6).toString('hex')}`;
  await adminPool.query(`CREATE DATABASE "${database}"`);
  createdDatabases.push(database);
  return databaseUrlFor(database);
}

function databaseUrlFor(database) {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function runMigrations(url, environment) {
  const result = spawnSync(process.execPath, ['src/db/migrate.js'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: url,
      NODE_ENV: environment
    }
  });

  assert.equal(
    result.status,
    0,
    `Migration runner failed in ${environment} mode:\n${result.stdout}\n${result.stderr}`
  );
  assert.match(result.stdout, /All migrations are up to date/);
}

async function verifyDatabase(url, expectDevelopmentSeed) {
  const pool = new Pool({ connectionString: url });
  try {
    const { rows: migrationRows } = await pool.query(
      'SELECT id FROM schema_migrations ORDER BY id'
    );
    const migrationIds = migrationRows.map(row => row.id);
    assert.ok(migrationIds.includes('001_initial_schema.sql'));
    assert.ok(migrationIds.includes('003_runtime_schema_alignment.sql'));
    assert.ok(migrationIds.includes('005_router_archiving.sql'));
    assert.ok(migrationIds.includes('006_checkout_plan_snapshot.sql'));
    assert.ok(migrationIds.includes('008_tenant_email_verification.sql'));
    assert.ok(migrationIds.includes('009_email_verification_codes.sql'));
    assert.equal(
      migrationIds.includes('002_seed_data.sql'),
      expectDevelopmentSeed,
      'development fixtures should only be recorded in development'
    );
    assert.equal(
      migrationIds.includes('004_development_seed_auth.sql'),
      expectDevelopmentSeed,
      'development auth fixture should only be recorded in development'
    );

    const { rows: columns } = await pool.query(`
      SELECT table_name, column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (
          (table_name = 'tenants' AND column_name = 'password_hash')
          OR (table_name = 'tenants' AND column_name IN (
            'email_verified_at', 'email_verification_code_hash',
            'email_verification_expires_at', 'email_verification_attempts'
          ))
          OR (table_name = 'routers' AND column_name = 'active')
          OR (table_name = 'routers' AND column_name IN (
            'last_poll_at', 'setup_stage', 'setup_updated_at'
          ))
          OR (table_name = 'transactions' AND column_name IN (
            'provider', 'plan_duration_min', 'plan_mikrotik_profile'
          ))
        )
    `);
    const columnMap = new Map(columns.map(row => [
      `${row.table_name}.${row.column_name}`,
      row
    ]));
    assert.ok(columnMap.has('tenants.password_hash'));
    assert.ok(columnMap.has('tenants.email_verified_at'));
    assert.ok(columnMap.has('tenants.email_verification_code_hash'));
    assert.ok(columnMap.has('routers.last_poll_at'));
    assert.ok(columnMap.has('routers.setup_stage'));
    assert.ok(columnMap.has('routers.setup_updated_at'));
    assert.equal(columnMap.get('routers.active').column_default, 'true');
    assert.equal(columnMap.get('transactions.provider').column_default, "'MPESA'::text");
    assert.equal(columnMap.get('transactions.plan_duration_min').is_nullable, 'NO');
    assert.equal(columnMap.get('transactions.plan_mikrotik_profile').is_nullable, 'NO');

    const { rows: tenantRows } = await pool.query(
      `SELECT email, password_hash, mpesa_key_enc, email_verified_at
       FROM tenants WHERE id = '11111111-1111-1111-1111-111111111111'`
    );
    assert.equal(tenantRows.length, expectDevelopmentSeed ? 1 : 0);
    if (expectDevelopmentSeed) {
      assert.equal(tenantRows[0].email, 'admin@eldoretfast.co.ke');
      assert.equal(bcrypt.compareSync('password123', tenantRows[0].password_hash), true);
      assert.equal(tenantRows[0].mpesa_key_enc, null);
      assert.ok(tenantRows[0].email_verified_at);

      const { rows: plans } = await pool.query(
        `SELECT COUNT(*)::integer AS count FROM hotspot_plans
         WHERE tenant_id = '11111111-1111-1111-1111-111111111111'`
      );
      assert.equal(plans[0].count, 3);

      const { rows: routerRows } = await pool.query(
        `SELECT active, health FROM routers
         WHERE id = '22222222-2222-2222-2222-222222222222'`
      );
      assert.deepEqual(routerRows[0], { active: true, health: 'OFFLINE' });
    }
  } finally {
    await pool.end();
  }
}
