process.env.JWT_SECRET = 'test-jwt-secret';

const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { beforeEach, test } = require('node:test');
const authRepo = require('../src/modules/auth/auth.repo');
const authService = require('../src/modules/auth/auth.service');
const emailService = require('../src/services/email.service');
const { createRateLimiter } = require('../src/middlewares/rate-limit');

const originalCreateTenant = authRepo.createTenant;
const originalFindTenantByEmail = authRepo.findTenantByEmail;
const originalVerifyEmail = authRepo.verifyEmail;
const originalSendVerificationEmail = emailService.sendVerificationEmail;
const originalEnsureEmailConfigured = emailService.ensureConfigured;
const originalUpdateUnverifiedTenantVerificationCode =
  authRepo.updateUnverifiedTenantVerificationCode;

beforeEach(() => {
  authRepo.createTenant = originalCreateTenant;
  authRepo.findTenantByEmail = originalFindTenantByEmail;
  authRepo.verifyEmail = originalVerifyEmail;
  authRepo.updateUnverifiedTenantVerificationCode = originalUpdateUnverifiedTenantVerificationCode;
  emailService.sendVerificationEmail = originalSendVerificationEmail;
  emailService.ensureConfigured = originalEnsureEmailConfigured;
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.RESEND_FROM_EMAIL = 'verify@example.test';
});

test('register normalizes data, stores a verification code hash, and emails the code', async () => {
  let values;
  let sent;
  authRepo.createTenant = async (...args) => {
    values = args;
    return {
      id: 'tenant-1',
      name: args[0],
      email: args[1],
      status: 'ACTIVE'
    };
  };
  emailService.sendVerificationEmail = async (...args) => { sent = args; };

  const result = await authService.register(
    '  Example ISP  ',
    '  ADMIN@EXAMPLE.COM ',
    'a-long-enough-password'
  );

  assert.deepEqual(values.slice(0, 2), ['Example ISP', 'admin@example.com']);
  assert.equal(await bcrypt.compare('a-long-enough-password', values[2]), true);
  assert.match(values[3], /^[a-f0-9]{64}$/);
  assert.ok(values[4] instanceof Date);
  assert.deepEqual(sent.slice(0, 2), ['admin@example.com', 'Example ISP']);
  assert.match(sent[2], /^\d{8}$/);
  assert.equal(
    require('node:crypto').createHash('sha256').update(sent[2]).digest('hex'),
    values[3]
  );
  assert.match(result.message, /8-digit verification code/);
  assert.equal(Object.hasOwn(result, 'token'), false);
});

test('register rejects invalid input without creating a tenant', async () => {
  let called = false;
  authRepo.createTenant = async () => { called = true; };

  await assert.rejects(
    authService.register('A', 'admin@example.com', 'a-long-enough-password'),
    /ISP name/
  );
  await assert.rejects(
    authService.register('Example ISP', 'not-an-email', 'a-long-enough-password'),
    /valid email/
  );
  await assert.rejects(
    authService.register('Example ISP', 'admin@example.com', 'short'),
    /Password/
  );
  assert.equal(called, false);
});

test('register propagates duplicate email errors from the database', async () => {
  authRepo.createTenant = async () => {
    throw new Error('Email already registered');
  };

  await assert.rejects(
    authService.register('Example ISP', 'admin@example.com', 'a-long-enough-password'),
    /Email already registered/
  );
});

test('login requires a verified email after checking the password', async () => {
  const passwordHash = await bcrypt.hash('a-long-enough-password', 4);
  authRepo.findTenantByEmail = async () => ({
    id: 'tenant-1',
    email: 'admin@example.com',
    password_hash: passwordHash,
    status: 'ACTIVE',
    email_verified_at: null
  });

  await assert.rejects(
    authService.login('admin@example.com', 'wrong-password'),
    /Invalid credentials/
  );
  await assert.rejects(
    authService.login('admin@example.com', 'a-long-enough-password'),
    /Email not verified/
  );
});

test('verification hashes the code before checking it and rejects malformed codes', async () => {
  let storedHash;
  authRepo.verifyEmail = async (_email, codeHash) => {
    storedHash = codeHash;
    return true;
  };
  const code = '00234567';

  const result = await authService.verifyEmail('ADMIN@example.com', code);
  assert.match(storedHash, /^[a-f0-9]{64}$/);
  assert.notEqual(storedHash, code);
  assert.match(result.message, /verified/);
  await assert.rejects(
    authService.verifyEmail('admin@example.com', 'bad-code'),
    /invalid, expired, or has too many attempts/
  );
  await assert.rejects(
    authService.verifyEmail('invalid-email', code),
    /invalid, expired, or has too many attempts/
  );
});

test('resending replaces the previous code and sends a new code', async () => {
  let update;
  let sent;
  authRepo.updateUnverifiedTenantVerificationCode = async (...args) => {
    update = args;
    return { email: 'admin@example.com', name: 'Example ISP' };
  };
  emailService.sendVerificationEmail = async (...args) => { sent = args; };

  const result = await authService.resendVerificationEmail(' ADMIN@example.com ');
  assert.equal(update[0], 'admin@example.com');
  assert.match(update[1], /^[a-f0-9]{64}$/);
  assert.ok(update[2] instanceof Date);
  assert.match(sent[2], /^\d{8}$/);
  assert.equal(
    require('node:crypto').createHash('sha256').update(sent[2]).digest('hex'),
    update[1]
  );
  assert.match(result.message, /verification code has been sent/);
});

test('rate limiter blocks repeated login attempts for the same IP', () => {
  const limiter = createRateLimiter({
    maxAttempts: 2,
    windowMs: 60000,
    suffix: 'login-test'
  });

  const req = {
    headers: { 'x-forwarded-for': '203.0.113.9' },
    body: { email: 'admin@example.com' },
    ip: '203.0.113.9'
  };

  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  let nextCount = 0;
  const next = () => { nextCount += 1; };

  limiter(req, res, next);
  limiter({
    ...req,
    headers: { 'x-forwarded-for': '198.51.100.15' }
  }, res, next);
  const blocked = limiter(req, res, next);

  assert.equal(nextCount, 2);
  assert.equal(res.statusCode, 429);
  assert.equal(blocked, res);
  assert.equal(res.body.error.includes('Too many requests'), true);
});
