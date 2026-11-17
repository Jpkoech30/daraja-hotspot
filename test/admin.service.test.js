process.env.ENCRYPTION_KEY = '00'.repeat(32);

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { beforeEach, test } = require('node:test');
const adminRepo = require('../src/modules/admin/admin.repo');
const adminService = require('../src/modules/admin/admin.service');
const { decrypt } = require('../src/utils/crypto');

const repoMethods = [
  'createPlan',
  'updatePlan',
  'archivePlan',
  'createRouter',
  'getRouterByAgentTokenHash',
  'updateRouterGatewayByAgentTokenHash',
  'getRouterPortalDetailsByAgentTokenHash',
  'deleteRouters',
  'getPlans',
  'updateMpesaSettings',
  'getDashboardOverview'
];
const originals = Object.fromEntries(repoMethods.map(name => [name, adminRepo[name]]));

beforeEach(() => {
  for (const name of repoMethods) adminRepo[name] = originals[name];
});

test('createPlan trims fields and scopes the insert to its tenant', async () => {
  let args;
  adminRepo.createPlan = async (...values) => {
    args = values;
    return { id: 'plan-1' };
  };

  const result = await adminService.createPlan('tenant-1', {
    name: '  Hourly  ',
    price: '20.50',
    durationMin: '60',
    profile: '  1hour  '
  });

  assert.deepEqual(args, ['tenant-1', 'Hourly', 20.5, 60, '1hour']);
  assert.deepEqual(result, { id: 'plan-1' });
});

test('createPlan rejects invalid prices and durations before database access', async () => {
  let called = false;
  adminRepo.createPlan = async () => { called = true; };

  await assert.rejects(
    adminService.createPlan('tenant-1', {
      name: 'Hourly', price: 0, durationMin: 60, profile: '1hour'
    }),
    /positive numbers/
  );
  await assert.rejects(
    adminService.createPlan('tenant-1', {
      name: 'Hourly', price: 20, durationMin: 1.5, profile: '1hour'
    }),
    /positive numbers/
  );
  assert.equal(called, false);
});

test('updatePlan preserves archived state unless active is specified', async () => {
  let args;
  adminRepo.updatePlan = async (...values) => {
    args = values;
    return { id: 'plan-1', active: false };
  };

  await adminService.updatePlan('tenant-1', 'plan-1', {
    name: 'Hourly', price: 20, durationMin: 60, profile: '1hour'
  });

  assert.deepEqual(args, ['tenant-1', 'plan-1', 'Hourly', 20, 60, '1hour', undefined]);
});

test('dashboard overview accepts only supported reporting periods', async () => {
  let args;
  adminRepo.getDashboardOverview = async (...values) => {
    args = values;
    return { days: values[1] };
  };

  assert.deepEqual(await adminService.getDashboardOverview('tenant-1'), { days: 30 });
  assert.deepEqual(await adminService.getDashboardOverview('tenant-1', 7), { days: 7 });
  assert.deepEqual(args, ['tenant-1', 7]);
  await assert.rejects(
    adminService.getDashboardOverview('tenant-1', 14),
    /7, 30, or 90/
  );
});

test('router creation validates the name before creating credentials', async () => {
  let called = false;
  adminRepo.createRouter = async () => { called = true; };

  await assert.rejects(
    adminService.generateRouterScript('tenant-1', ''),
    /Router name is required/
  );
  assert.equal(called, false);
});

test('bulk router deletion validates IDs and blocks routers with payment history', async () => {
  let received;
  adminRepo.deleteRouters = async (...values) => {
    received = values;
    return { requestedCount: 0, alreadyPendingCount: 0, blockedRouters: ['Main Router'] };
  };

  await assert.rejects(
    adminService.deleteRouters('tenant-1', []),
    /Select at least one router/
  );
  await assert.rejects(
    adminService.deleteRouters('tenant-1', ['not-a-uuid']),
    /invalid router ID/
  );
  await assert.rejects(
    adminService.deleteRouters('tenant-1', ['11111111-1111-1111-1111-111111111111']),
    /Main Router.*Archive them instead/
  );
  assert.deepEqual(received, [
    'tenant-1',
    ['11111111-1111-1111-1111-111111111111']
  ]);
});

test('bulk router deletion deduplicates IDs and queues remote uninstall', async () => {
  let received;
  adminRepo.deleteRouters = async (...values) => {
    received = values;
    return { requestedCount: 2, alreadyPendingCount: 1, blockedRouters: [] };
  };
  const routerId = '11111111-1111-1111-1111-111111111111';

  assert.deepEqual(
    await adminService.deleteRouters('tenant-1', [routerId, routerId]),
    { requestedCount: 2, alreadyPendingCount: 1, blockedRouters: [] }
  );
  assert.deepEqual(received, ['tenant-1', [routerId]]);
});

test('router setup creates a token and generates an auto-discovery bootstrap command', async () => {
  let args;
  adminRepo.getPlans = async () => [];
  adminRepo.createRouter = async (...values) => {
    args = values;
    return { id: 'router-1', name: values[1] };
  };

  const previousBackendUrl = process.env.BACKEND_URL;
  process.env.BACKEND_URL = 'https://isp.example.test/';
  try {
    const result = await adminService.generateRouterScript('tenant-1', 'Main');
    const token = result.script.match(/X-Agent-Token: (rt_[a-f0-9]+)/)[1];

    assert.equal(result.routerId, 'router-1');
    assert.equal(args[0], 'tenant-1');
    assert.equal(args[2], '192.168.88.1');
    assert.equal(args[3], crypto.createHash('sha256').update(token).digest('hex'));
    assert.equal(result.script.includes('\n'), false);
    assert.match(result.script, /https:\/\/isp\.example\.test\/api\/agents\/discover/);
    assert.match(result.script, /http-header-field="X-Agent-Token: rt_[a-f0-9]+"/);
    assert.match(result.script, /\/import file-name="daraja-setup\.rsc"/);
    assert.match(result.script, /\/file remove \[find name="daraja-setup\.rsc"\]/);
  } finally {
    if (previousBackendUrl === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previousBackendUrl;
  }
});

test('router setup passes an explicitly selected LAN interface to discovery', async () => {
  adminRepo.getPlans = async () => [];
  adminRepo.createRouter = async () => ({ id: 'router-1', name: 'Main' });
  const previousBackendUrl = process.env.BACKEND_URL;
  process.env.BACKEND_URL = 'https://isp.example.test';
  try {
    const result = await adminService.generateRouterScript('tenant-1', 'Main', 'ether3');
    const token = result.script.match(/X-Agent-Token: (rt_[a-f0-9]+)/)[1];

    assert.match(result.script, /\/api\/agents\/discover\?interface=ether3/);
    const originalGetRouter = adminRepo.getRouterByAgentTokenHash;
    adminRepo.getRouterByAgentTokenHash = async hash => {
      assert.equal(hash, crypto.createHash('sha256').update(token).digest('hex'));
      return { id: 'router-1', tenant_id: 'tenant-1', name: 'Main' };
    };
    try {
      const discovery = await adminService.generateRouterDiscoveryScript(token, 'ether3');
      assert.match(discovery, /:local requestedHotspotInterface "ether3"/);
      assert.match(discovery, /dhcp-client find where disabled=no and interface=\$requestedHotspotInterface/);
      assert.match(discovery, /:find \$immediateGateway \("%" \. \$requestedHotspotInterface\)/);
      assert.match(discovery, /selectedInterfaceIsWan/);
      assert.match(discovery, /selected customer LAN interface is also used by the WAN/);
      assert.match(discovery, /:set hotspotInterface \$requestedHotspotInterface/);
      assert.match(discovery, /select the bridge, not a bridged Ethernet port/);
    } finally {
      adminRepo.getRouterByAgentTokenHash = originalGetRouter;
    }
  } finally {
    if (previousBackendUrl === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previousBackendUrl;
  }
});

test('router discovery script excludes WAN interfaces and refuses ambiguous layouts', async () => {
  const token = 'rt_discover-test';
  adminRepo.getRouterByAgentTokenHash = async hash => {
    assert.equal(hash, crypto.createHash('sha256').update(token).digest('hex'));
    return { id: 'router-1', tenant_id: 'tenant-1', name: 'Main', local_ip: '192.168.88.1' };
  };
  const previousBackendUrl = process.env.BACKEND_URL;
  process.env.BACKEND_URL = 'https://isp.example.test';
  try {
    const script = await adminService.generateRouterDiscoveryScript(token);
    assert.match(script, /\/ip dhcp-client find where disabled=no/);
    assert.match(script, /http-data="dhcp-client-scan-complete"/);
    assert.match(script, /DARAJA_SETUP: default-route-scan-started/);
    assert.match(script, /DARAJA_SETUP: active-default-routes/);
    assert.match(script, /\/ip route find where dst-address="0\.0\.0\.0\/0" and active/);
    assert.match(script, /DARAJA_SETUP: default-route-entry-complete/);
    assert.match(script, /:local immediateGateways \[:toarray \$immediateGateway\]/);
    assert.match(script, /:foreach gatewayEntry in=\$immediateGateways do=\{/);
    assert.match(script, /DARAJA_SETUP: default-route-entry-parsed/);
    assert.doesNotMatch(script, /:while \(\$interfaceSeparator != nil\)/);
    assert.match(script, /http-data="default-route-scan-complete"/);
    assert.match(script, /bridgeContainsWan false/);
    assert.match(script, /interface bridge port get \$portId interface/);
    assert.match(script, /http-data="bridge-scan-complete"/);
    assert.match(script, /http-data="ethernet-scan-complete"/);
    assert.match(script, /http-data="lan-interface-selected"/);
    assert.match(script, /http-data="gateway-selected"/);
    assert.match(script, /LAN interface detection was ambiguous/);
    assert.match(script, /\/ip address find where interface=\$hotspotInterface/);
    assert.match(script, /LAN already has a DHCP server but no gateway IP/);
    assert.match(script, /no unused automatic 192\.168\.x\.0\/24 LAN subnet found/);
    assert.match(script, /\/api\/agents\/install\?interface=/);
    assert.match(script, /http-data="install-file-downloaded"/);
    assert.match(script, /http-data="install-import-started"/);
    assert.match(script, /:onerror fetchError in=\{/);
    assert.match(script, /DARAJA_SETUP: install-fetch-error/);
    assert.ok(script.includes('see install-fetch-error above'));
    assert.ok(script.includes('RouterOS HTTPS/TLS support'));
    assert.match(script, /as-value output=user/);
    assert.match(script, /DARAJA_SETUP: install-file-downloaded/);
    assert.match(script, /Daraja detected customer LAN/);
    assert.match(script, /if \(\[:len \[\/file find where name="daraja-setup-final\.rsc"\]\] > 0\) do=\{ \/file remove/);
    assert.doesNotMatch(script, /\/file remove \[find name="daraja-setup-final\.rsc"\]/);
  } finally {
    if (previousBackendUrl === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previousBackendUrl;
  }
});

test('router install endpoint script provisions hotspot and poller using the matching router token', async () => {
  const token = 'rt_test-token';
  let receivedHash;
  adminRepo.getRouterByAgentTokenHash = async (hash) => {
    receivedHash = hash;
    return {
      id: 'router-1',
      tenant_id: 'tenant-1',
      name: 'Main',
      local_ip: '192.168.88.1'
    };
  };
  adminRepo.getPlans = async () => ([
    { active: true, mikrotik_profile: 'hourly' },
    { active: false, mikrotik_profile: 'archived' }
  ]);

  const previousBackendUrl = process.env.BACKEND_URL;
  process.env.BACKEND_URL = 'https://isp.example.test';
  try {
    const script = await adminService.generateRouterInstallScript(token, 'bridge', '192.168.88.1');
    assert.equal(receivedHash, crypto.createHash('sha256').update(token).digest('hex'));
    assert.match(script, /\/ip hotspot add name="daraja-hotspot-server"/);
    assert.match(script, /dst-host="isp\.example\.test" dst-port=443/);
    assert.match(script, /dst-path="hotspot\/login\.html"/);
    assert.match(script, /html-directory=hotspot login-by=http-pap/);
    assert.match(script, /Daraja setup stopped: DHCP subnet already uses a different gateway/);
    assert.match(script, /customer LAN already has a non-Daraja hotspot server/);
    assert.match(script, /\/ip hotspot profile add name="daraja-hotspot-profile" hotspot-address=\$hotspotGatewayAddress/);
    assert.doesNotMatch(script, /\/ip hotspot profile add[^\r\n]*comment=/);
    assert.match(script, /\/ip hotspot active remove \[find where user=\$userName\]/);
    assert.match(script, /\/api\/agents\/configure/);
    assert.match(script, /DARAJA_SETUP: gateway-configure-fetch-error/);
    assert.match(script, /see gateway-configure-fetch-error above/);
    assert.match(script, /\/api\/agents\/setup-status/);
    assert.match(script, /poller-installed/);
    assert.match(script, /as-value output=user/);
    assert.match(script, /Agent poll fetch did not finish/);
    assert.match(script, /:set response \(\$fetchResult->"data"\)/);
    assert.match(script, /:if \(\$response != "NONE"\) do=\{/);
    assert.match(script, /:onerror heartbeatError in=\{/);
    assert.match(script, /:while \(\(\$heartbeatAttempt < 3\) && \(!\$heartbeatSucceeded\)\) do=\{/);
    assert.match(script, /:if \(\$heartbeatAttempt < 3\) do=\{ :delay 2s \}/);
    assert.match(script, /heartbeat fetch did not finish/i);
    assert.match(script, /heartbeat failed after 3 attempts; continuing installation/);
    assert.match(script, /DARAJA_SETUP: heartbeat-fetch-error/);
    assert.match(script, /DARAJA_SETUP: heartbeat-unavailable-continuing/);
    assert.match(script, /DARAJA_SETUP: heartbeat-fetch-succeeded attempt/);
    assert.match(script, /\$jobId~"\^\[0-9a-fA-F\]\{8\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{12\}\\\$"/);
    assert.match(script, /malformed job response; result not submitted/);
    assert.match(script, /:global darajaPollFailures/);
    assert.match(script, /:global darajaAgentToken/);
    assert.match(script, /:global darajaUninstallPending/);
    assert.match(script, /:if \(\$action = "UNINSTALL"\) do=\{/);
    assert.match(script, /\/ip hotspot user profile add name=\$profile comment="Daraja Hotspot"/);
    assert.match(script, /Daraja payment portal/);
    assert.match(script, /\/ip pool find where name="daraja-hotspot-pool"/);
    assert.match(script, /\/ip hotspot profile find where name="daraja-hotspot-profile"/);
    assert.match(script, /\/ip hotspot user profile find where comment="Daraja Hotspot"/);
    assert.match(script, /\/api\/agents\/uninstall-complete/);
    assert.match(script, /DARAJA_SETUP: uninstall-complete/);
    assert.match(script, /\(\[:typeof \$darajaAgentToken\] = "nothing"\) \|\| \(\$darajaAgentToken != \$agentToken\)/);
    assert.match(script, /:set darajaLastResult ""/);
    assert.match(script, /Daraja agent poll failed \(/);
    assert.match(script, /Daraja agent poll recovered after/);
    assert.match(script, /:onerror fetchError in=\{/);
    assert.match(script, /:onerror jobError in=\{/);
    assert.match(script, /\$jobId \. ":FAILED:" \. \$jobError/);
    assert.match(script, /http-data="PING" as-value output=user/);
    assert.match(script, /http-data="installer-started" as-value output=user/);
    assert.match(script, /system script add name="daraja-agent-poll" policy=ftp,read,write,policy,test source=/);
    assert.match(script, /system scheduler add name="daraja-agent-scheduler" interval=30s on-event="daraja-agent-poll" policy=ftp,read,write,policy,test/);
    assert.doesNotMatch(script, /policy=[^\r\n]*\bapi\b/);
    assert.match(script, /if \(\[:len \[\/system script find where name="daraja-agent-poll"\]\] > 0\) do=\{ \/system script remove/);
    assert.match(script, /if \(\[:len \[\/system scheduler find where name="daraja-agent-scheduler"\]\] > 0\) do=\{ \/system scheduler remove/);
    assert.doesNotMatch(script, /agent-res\.txt|daraja-agent-heartbeat\.txt/);
    assert.match(script, /agent poll script was not created; scheduler was not installed/);
    assert.ok(
      script.indexOf('/system script add name="daraja-agent-poll"')
        < script.indexOf('/ip pool add name="daraja-hotspot-pool"')
    );
    assert.ok(
      script.indexOf('agent poll script was not created; scheduler was not installed')
        < script.lastIndexOf('/system scheduler add name="daraja-agent-scheduler"')
    );
    assert.match(script, /name="hourly"/);
    assert.doesNotMatch(script, /name="archived"/);
    assert.match(script, /https:\/\/isp\.example\.test\/api\/agents\/poll/);
    assert.match(script, /https:\/\/isp\.example\.test\/api\/agents\/heartbeat/);
    assert.match(script, /\/system script run daraja-agent-poll/);
    assert.match(script, /\/system scheduler add name="daraja-agent-scheduler" interval=30s on-event="daraja-agent-poll"/);
    assert.ok(
      script.indexOf('/tool fetch url="https://isp.example.test/api/agents/hotspot-login?routerId=router-1"')
        < script.lastIndexOf('/system scheduler add name="daraja-agent-scheduler"')
    );
    assert.doesNotMatch(script, /on-event="\/system script run daraja-agent-poll"/);
  } finally {
    if (previousBackendUrl === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previousBackendUrl;
  }
});

test('router gateway registration only updates the router matched by its agent token', async () => {
  let args;
  adminRepo.updateRouterGatewayByAgentTokenHash = async (...values) => {
    args = values;
    return { id: 'router-1', local_ip: values[1] };
  };
  const token = 'rt_register-gateway';

  assert.deepEqual(await adminService.updateRouterGateway(token, '192.168.89.1'), {
    id: 'router-1',
    local_ip: '192.168.89.1'
  });
  assert.deepEqual(args, [
    crypto.createHash('sha256').update(token).digest('hex'),
    '192.168.89.1'
  ]);
  await assert.rejects(adminService.updateRouterGateway(token, 'not-an-ip'), /valid IPv4 address/);
});

test('hotspot login page redirects unauthenticated clients to the tenant portal with router context', async () => {
  let receivedHash;
  adminRepo.getRouterPortalDetailsByAgentTokenHash = async (hash, routerId) => {
    receivedHash = [hash, routerId];
    return { id: routerId, tenant_id: 'tenant-1' };
  };
  const previousBackendUrl = process.env.BACKEND_URL;
  process.env.BACKEND_URL = 'https://isp.example.test';
  try {
    const token = 'rt_login-page-test';
    const page = await adminService.generateHotspotLoginPage(token, 'router-1');
    assert.deepEqual(receivedHash, [
      crypto.createHash('sha256').update(token).digest('hex'),
      'router-1'
    ]);
    assert.match(page, /https:\/\/isp\.example\.test\/\?tenantId=tenant-1&routerId=router-1/);
    assert.match(page, /mac=\$\(mac-esc\)&loginUrl=\$\(link-login-only-esc\)/);
    assert.match(page, /dst=\$\(link-orig-esc\)/);
  } finally {
    if (previousBackendUrl === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previousBackendUrl;
  }
});

test('router install script rejects unknown tokens and invalid detected setup parameters', async () => {
  adminRepo.getRouterByAgentTokenHash = async () => ({
    id: 'router-1',
    tenant_id: 'tenant-1',
    name: 'Main',
    local_ip: '192.168.88.1'
  });
  const previousBackendUrl = process.env.BACKEND_URL;
  process.env.BACKEND_URL = 'https://isp.example.test';
  try {
    await assert.rejects(
      adminService.generateRouterInstallScript('', 'bridge', '192.168.88.1'),
      /Router not found/
    );
    await assert.rejects(
      adminService.generateRouterInstallScript('rt_token', 'bridge', '192.168.88.0'),
      /host address from \.1 to \.254/
    );
  } finally {
    if (previousBackendUrl === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previousBackendUrl;
  }
});

test('router setup requires a reachable backend URL before creating router credentials', async () => {
  let called = false;
  const previousBackendUrl = process.env.BACKEND_URL;
  delete process.env.BACKEND_URL;
  adminRepo.createRouter = async () => { called = true; };

  try {
    await assert.rejects(
      adminService.generateRouterScript('tenant-1', 'Main'),
      /BACKEND_URL must be a valid HTTP\(S\) URL reachable from the MikroTik router/
    );
    assert.equal(called, false);
  } finally {
    if (previousBackendUrl === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previousBackendUrl;
  }
});

test('router installer validates detected interface and gateway values', async () => {
  adminRepo.getRouterByAgentTokenHash = async () => ({
    id: 'router-1',
    tenant_id: 'tenant-1',
    name: 'Main',
    local_ip: '192.168.88.1'
  });
  const previousBackendUrl = process.env.BACKEND_URL;
  process.env.BACKEND_URL = 'https://isp.example.test';
  try {
    await assert.rejects(
      adminService.generateRouterInstallScript('rt_token', 'ether2&gateway=evil', '192.168.88.1'),
      /interface name is invalid/
    );
    await assert.rejects(
      adminService.generateRouterInstallScript('rt_token', 'ether2', '192.168.88.0'),
      /host address from \.1 to \.254/
    );
  } finally {
    if (previousBackendUrl === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previousBackendUrl;
  }
});

test('M-Pesa credentials are encrypted before being stored', async () => {
  let args;
  adminRepo.updateMpesaSettings = async (...values) => {
    args = values;
    return { id: 'tenant-1' };
  };

  await adminService.saveMpesaSettings(
    'tenant-1', ' 174379 ', ' consumer-key ', ' consumer-secret ', ' passkey '
  );

  assert.equal(args[0], 'tenant-1');
  assert.equal(args[1], '174379');
  assert.equal(decrypt(args[2]), 'consumer-key');
  assert.equal(decrypt(args[3]), 'consumer-secret');
  assert.equal(decrypt(args[4]), 'passkey');
  assert.notEqual(args[2], 'consumer-key');
  assert.notEqual(args[3], 'consumer-secret');
  assert.notEqual(args[4], 'passkey');
});
