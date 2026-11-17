process.env.ENCRYPTION_KEY = '00'.repeat(32);

const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');
const checkoutController = require('../src/modules/checkout/checkout.controller');
const checkoutRepo = require('../src/modules/checkout/checkout.repo');
const checkoutService = require('../src/modules/checkout/checkout.service');

const originalGetTransactionAccess = checkoutRepo.getTransactionAccess;
const originalInitiateCheckout = checkoutService.initiateCheckout;

beforeEach(() => {
  checkoutRepo.getTransactionAccess = originalGetTransactionAccess;
  checkoutService.initiateCheckout = originalInitiateCheckout;
});

function createResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function createAccess(overrides = {}) {
  return {
    status: 'SUCCESS',
    mac_address: 'aa:bb:cc:dd:ee:ff',
    provisioning_status: 'SUCCESS',
    username: 'u_receipt',
    password: 'random-secret',
    router_local_ip: '192.168.88.1',
    ...overrides
  };
}

function accessRequest(query = {}) {
  return {
    params: { checkoutId: 'checkout-1' },
    query: {
      mac: 'AA:BB:CC:DD:EE:FF',
      loginUrl: 'http://192.168.88.1/login',
      ...query
    }
  };
}

test('checkout requires a client MAC address before starting payment', async () => {
  let called = false;
  checkoutService.initiateCheckout = async () => { called = true; };
  const response = createResponse();

  await checkoutController.checkout({
    body: {
      tenantId: 'tenant-1',
      routerId: 'router-1',
      planId: 'plan-1',
      phone: '254700000000'
    }
  }, response, assert.fail);

  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
});

test('access credentials are not returned for a different client MAC', async () => {
  checkoutRepo.getTransactionAccess = async () => createAccess();
  const response = createResponse();

  await checkoutController.getAccess(accessRequest({ mac: '00:00:00:00:00:00' }), response, assert.fail);

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'Payment access not found' });
});

test('access endpoint rejects a login URL outside the matching router login path', async () => {
  checkoutRepo.getTransactionAccess = async () => createAccess();
  const response = createResponse();

  await checkoutController.getAccess(
    accessRequest({ loginUrl: 'http://192.168.88.1.evil.test/login' }),
    response,
    assert.fail
  );

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'Router login URL does not match the payment router');
});

test('access endpoint rejects a path other than the router login endpoint', async () => {
  checkoutRepo.getTransactionAccess = async () => createAccess();
  const response = createResponse();

  await checkoutController.getAccess(
    accessRequest({ loginUrl: 'http://192.168.88.1/login-elsewhere' }),
    response,
    assert.fail
  );

  assert.equal(response.statusCode, 400);
});

test('access endpoint reports payment and provisioning states without credentials', async (t) => {
  const cases = [
    {
      name: 'pending payment',
      access: createAccess({ status: 'PENDING' }),
      status: 409,
      body: { error: 'Payment is not complete' }
    },
    {
      name: 'pending provisioning',
      access: createAccess({ provisioning_status: 'PENDING' }),
      status: 202,
      body: { ready: false }
    },
    {
      name: 'failed provisioning',
      access: createAccess({ provisioning_status: 'FAILED' }),
      status: 409,
      body: { error: 'Router could not provision the paid access' }
    }
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      checkoutRepo.getTransactionAccess = async () => item.access;
      const response = createResponse();

      await checkoutController.getAccess(accessRequest(), response, assert.fail);

      assert.equal(response.statusCode, item.status);
      assert.deepEqual(response.body, item.body);
    });
  }
});

test('access endpoint returns credentials only for paid and provisioned access', async () => {
  checkoutRepo.getTransactionAccess = async () => createAccess();
  const response = createResponse();

  await checkoutController.getAccess(accessRequest(), response, assert.fail);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ready: true,
    username: 'u_receipt',
    password: 'random-secret',
    loginUrl: 'http://192.168.88.1/login'
  });
  assert.equal(response.headers['Cache-Control'], 'no-store');
});
