const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const emailService = require('../src/services/email.service');

const originalFetch = global.fetch;
const originalEnvironment = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL
};

afterEach(() => {
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('sends a verification code through Resend with an escaped greeting', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_FROM_EMAIL = 'verify@example.test';
  let request;
  global.fetch = async (...args) => {
    request = args;
    return { ok: true };
  };

  await emailService.sendVerificationEmail(
    'admin@example.test',
    '<ISP & Co>',
    '01234567'
  );

  assert.equal(request[0], 'https://api.resend.com/emails');
  assert.equal(request[1].headers.Authorization, 'Bearer test-key');
  const message = JSON.parse(request[1].body);
  assert.equal(message.from, 'verify@example.test');
  assert.deepEqual(message.to, ['admin@example.test']);
  assert.match(message.html, /&lt;ISP &amp; Co&gt;/);
  assert.match(message.html, />01234567</);
  assert.match(message.text, /expires in 10 minutes/);
});

test('reports a failed Resend delivery explicitly', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_FROM_EMAIL = 'verify@example.test';
  global.fetch = async () => ({
    ok: false,
    status: 422,
    text: async () => 'invalid sender'
  });

  await assert.rejects(
    emailService.sendVerificationEmail('admin@example.test', 'ISP', '01234567'),
    /status 422: invalid sender/
  );
});

test('requires Resend configuration', () => {
  delete process.env.RESEND_API_KEY;
  process.env.RESEND_FROM_EMAIL = 'verify@example.test';

  assert.throws(emailService.ensureConfigured, /RESEND_API_KEY/);
});
