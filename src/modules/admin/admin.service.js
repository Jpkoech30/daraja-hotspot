const crypto = require('crypto');
const net = require('net');
const adminRepo = require('./admin.repo');
const { encrypt } = require('../../utils/crypto');

exports.saveMpesaSettings = async (tenantId, shortcode, consumerKey, consumerSecret, passkey) => {
  if (![shortcode, consumerKey, consumerSecret, passkey].every(
    value => typeof value === 'string' && value.trim()
  )) {
    throw new Error('All M-Pesa fields are required');
  }

  const keyEnc = encrypt(consumerKey.trim());
  const secretEnc = encrypt(consumerSecret.trim());
  const passkeyEnc = encrypt(passkey.trim());

  return await adminRepo.updateMpesaSettings(
    tenantId, shortcode.trim(), keyEnc, secretEnc, passkeyEnc
  );
};

exports.getMpesaSettings = async (tenantId) => adminRepo.getMpesaSettings(tenantId);

exports.clearMpesaSettings = async (tenantId) => adminRepo.clearMpesaSettings(tenantId);

exports.getDashboardStats = async (tenantId) => {
  return await adminRepo.getStats(tenantId);
};

exports.getDashboardOverview = async (tenantId, days = 30) => {
  const range = Number(days);
  if (![7, 30, 90].includes(range)) {
    throw new Error('Dashboard period must be 7, 30, or 90 days');
  }
  return adminRepo.getDashboardOverview(tenantId, range);
};

exports.getPlans = async (tenantId) => {
  return await adminRepo.getPlans(tenantId);
};

exports.createPlan = async (tenantId, data) => {
  const plan = validatePlan(data);
  return adminRepo.createPlan(
    tenantId, plan.name, plan.price, plan.durationMin, plan.profile
  );
};

exports.updatePlan = async (tenantId, planId, data) => {
  data = data || {};
  const plan = validatePlan(data);
  if (data.active !== undefined && typeof data.active !== 'boolean') {
    throw new Error('Plan active status must be a boolean');
  }
  const updated = await adminRepo.updatePlan(
    tenantId, planId, plan.name, plan.price, plan.durationMin, plan.profile, data.active
  );
  if (!updated) throw new Error('Plan not found');
  return updated;
};

exports.archivePlan = async (tenantId, planId) => {
  const archived = await adminRepo.archivePlan(tenantId, planId);
  if (!archived) throw new Error('Plan not found');
  return archived;
};

exports.getRouters = async (tenantId) => adminRepo.getRouters(tenantId);

exports.generateRouterScript = async (
  tenantId, routerName, requestedInterface
) => {
  const name = typeof routerName === 'string' ? routerName.trim() : '';
  if (!name) throw new Error('Router name is required');
  const interfaceName = typeof requestedInterface === 'string' && requestedInterface.trim()
    ? validateHotspotInterface(requestedInterface)
    : '';
  const { backendUrl } = getBackendUrl();

  const plans = await adminRepo.getPlans(tenantId);
  const profiles = [...new Set(
    plans.filter(plan => plan.active).map(plan => plan.mikrotik_profile)
  )];
  validateProfiles(profiles);

  const rawToken = `rt_${crypto.randomBytes(16).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const router = await adminRepo.createRouter(tenantId, name, '192.168.88.1', tokenHash);
  return {
    routerId: router.id,
    script: createRouterBootstrapCommand(backendUrl, rawToken, interfaceName)
  };
};

exports.generateRouterDiscoveryScript = async (rawToken, requestedInterface) => {
  if (typeof rawToken !== 'string' || !rawToken) throw new Error('Router not found');
  const interfaceName = typeof requestedInterface === 'string' && requestedInterface.trim()
    ? validateHotspotInterface(requestedInterface)
    : '';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const router = await adminRepo.getRouterByAgentTokenHash(tokenHash);
  if (!router) throw new Error('Router not found');
  const { backendUrl } = getBackendUrl();
  return buildRouterDiscoveryScript(backendUrl, rawToken, router.name, interfaceName);
};

exports.generateRouterInstallScript = async (rawToken, hotspotInterface, localIp) => {
  if (typeof rawToken !== 'string' || !rawToken) throw new Error('Router not found');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const router = await adminRepo.getRouterByAgentTokenHash(tokenHash);
  if (!router) throw new Error('Router not found');

  const { backendUrl } = getBackendUrl();
  const interfaceName = validateHotspotInterface(hotspotInterface);
  const address = validateHotspotGateway(localIp);
  const plans = await adminRepo.getPlans(router.tenant_id);
  const profiles = [...new Set(
    plans.filter(plan => plan.active).map(plan => plan.mikrotik_profile)
  )];
  validateProfiles(profiles);

  return buildRouterProvisioningScript({
    backendUrl,
    rawToken,
    routerId: router.id,
    routerName: router.name,
    interfaceName,
    address,
    profiles
  });
};

exports.updateRouterGateway = async (rawToken, localIp) => {
  if (typeof rawToken !== 'string' || !rawToken) throw new Error('Router not found');
  const address = validateHotspotGateway(localIp);
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const updated = await adminRepo.updateRouterGatewayByAgentTokenHash(tokenHash, address);
  if (!updated) throw new Error('Router not found');
  return updated;
};

exports.generateHotspotLoginPage = async (rawToken, routerId) => {
  if (typeof rawToken !== 'string' || !rawToken) throw new Error('Router not found');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const router = await adminRepo.getRouterPortalDetailsByAgentTokenHash(tokenHash, routerId);
  if (!router) throw new Error('Router not found');

  const { backendUrl } = getBackendUrl();
  const portalUrl = escapeHtmlAttribute(`${backendUrl}/portal/`);
  const tenantId = escapeHtmlAttribute(router.tenant_id);
  const safeRouterId = escapeHtmlAttribute(router.id);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connecting to Wi-Fi</title></head>
<body>
<p>Opening the Wi-Fi payment page...</p>
<script>
window.location.replace("${portalUrl}?tenantId=${tenantId}&routerId=${safeRouterId}&mac=$(mac-esc)&loginUrl=$(link-login-only-esc)&dst=$(link-orig-esc)");
</script>
</body>
</html>`;
};

function buildRouterProvisioningScript({
  backendUrl, rawToken, routerId, routerName, interfaceName, address, profiles
}) {
  const [first, second, third, fourth] = address.split('.').map(Number);
  const subnet = `${first}.${second}.${third}`;
  const network = `${subnet}.0/24`;
  const poolRanges = getPoolRanges(subnet, fourth);
  const escapedInterface = escapeRouterOsString(interfaceName);
  const escapedGateway = escapeRouterOsString(`${address}/24`);
  const escapedGatewayAddress = escapeRouterOsString(address);
  const escapedNetwork = escapeRouterOsString(network);
  const escapedPoolRanges = escapeRouterOsString(poolRanges);
  const escapedBackendUrl = escapeRouterOsString(backendUrl);
  const backend = new URL(backendUrl);
  const backendPort = backend.port || (backend.protocol === 'https:' ? '443' : '80');
  const escapedBackendHost = escapeRouterOsString(backend.hostname);
  const routerLabel = routerName.replace(/[\r\n]/g, ' ');

  return `
# DARAJA HOTSPOT ROUTER SETUP - ${routerLabel}
:local hotspotInterface "${escapedInterface}"
:local hotspotGateway "${escapedGateway}"
:local hotspotGatewayAddress "${escapedGatewayAddress}"
:local hotspotNetwork "${escapedNetwork}"
:local hotspotPoolRanges "${escapedPoolRanges}"
:put "DARAJA_SETUP: installer-started"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'installer-started')}
:if ([:len [/interface find where name=$hotspotInterface]] = 0) do={ :error "Daraja setup stopped: hotspot interface not found" }
:if (([:len [/ip address find where interface=$hotspotInterface]] > 0) && ([:len [/ip address find where interface=$hotspotInterface and address=$hotspotGateway]] = 0)) do={ :error "Daraja setup stopped: selected interface has a different IP address than the gateway entered here" }
:if (([:len [/ip hotspot find where interface=$hotspotInterface]] > 0) && ([:len [/ip hotspot find where interface=$hotspotInterface and name="daraja-hotspot-server"]] = 0)) do={ :error "Daraja setup stopped: customer LAN already has a non-Daraja hotspot server; back it up and remove or migrate it before setup" }
${buildAgentHeartbeatBootstrapScript(backendUrl, rawToken)}
:put "DARAJA_SETUP: heartbeat-installed"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'heartbeat-installed')}
:if ([:len [/ip address find where interface=$hotspotInterface and address=$hotspotGateway]] = 0) do={ /ip address add address=$hotspotGateway interface=$hotspotInterface comment="Daraja Hotspot" }
:if ([:len [/ip pool find where name="daraja-hotspot-pool"]] = 0) do={ /ip pool add name="daraja-hotspot-pool" ranges=$hotspotPoolRanges comment="Daraja Hotspot" }
:if (([:len [/ip dhcp-server network find where address=$hotspotNetwork]] > 0) && ([:len [/ip dhcp-server network find where address=$hotspotNetwork and gateway=$hotspotGatewayAddress]] = 0)) do={ :error "Daraja setup stopped: DHCP subnet already uses a different gateway" }
:if ([:len [/ip dhcp-server network find where address=$hotspotNetwork]] = 0) do={ /ip dhcp-server network add address=$hotspotNetwork gateway=$hotspotGatewayAddress dns-server=1.1.1.1,8.8.8.8 comment="Daraja Hotspot" }
:if ([:len [/ip dhcp-server find where interface=$hotspotInterface]] = 0) do={ /ip dhcp-server add name="daraja-hotspot-dhcp" interface=$hotspotInterface address-pool="daraja-hotspot-pool" lease-time=1h disabled=no }
:if ([:len [/ip hotspot profile find where name="daraja-hotspot-profile"]] = 0) do={ /ip hotspot profile add name="daraja-hotspot-profile" hotspot-address=$hotspotGatewayAddress }
/ip hotspot profile set [find where name="daraja-hotspot-profile"] hotspot-address=$hotspotGatewayAddress html-directory=hotspot login-by=http-pap
:if ([:len [/ip hotspot walled-garden find where comment="Daraja payment portal"]] = 0) do={ /ip hotspot walled-garden add dst-host="${escapedBackendHost}" dst-port=${backendPort} comment="Daraja payment portal" } else={ /ip hotspot walled-garden set [find where comment="Daraja payment portal"] dst-host="${escapedBackendHost}" dst-port=${backendPort} }
:if ([:len [/file find where name="hotspot/login.html"]] > 0) do={ /file remove [find where name="hotspot/login.html"] }
/tool fetch url="${escapedBackendUrl}/api/agents/hotspot-login?routerId=${encodeURIComponent(routerId)}" http-header-field="X-Agent-Token: ${rawToken}" dst-path="hotspot/login.html"
${profiles.map(profile => {
    const escapedProfile = escapeRouterOsString(profile);
    return `:if ([:len [/ip hotspot user profile find where name="${escapedProfile}"]] = 0) do={ /ip hotspot user profile add name="${escapedProfile}" comment="Daraja Hotspot" }`;
  }).join('\n')}
:if ([:len [/ip hotspot find where interface=$hotspotInterface]] = 0) do={ /ip hotspot add name="daraja-hotspot-server" interface=$hotspotInterface profile="daraja-hotspot-profile" disabled=no } else={ /ip hotspot set [find where interface=$hotspotInterface] profile="daraja-hotspot-profile" }
:put "DARAJA_SETUP: hotspot-configured"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'hotspot-configured')}
:local configureFailed false
:local configureFetchError ""
:onerror fetchError in={
    /tool fetch url="${escapedBackendUrl}/api/agents/configure" http-method=post http-header-field="X-Agent-Token: ${rawToken},Content-Type: text/plain" http-data=$hotspotGatewayAddress dst-path="daraja-config.txt"
} do={
    :set configureFailed true
    :set configureFetchError $fetchError
    :put ("DARAJA_SETUP: gateway-configure-fetch-error " . $fetchError)
}
:if ($configureFailed) do={ :error "Daraja setup could not register the detected gateway; see gateway-configure-fetch-error above" }
:if ([:len [/file find where name="daraja-config.txt"]] = 0) do={ :error "Daraja setup did not receive gateway confirmation from the backend" }
:local configureResponse [/file get [find where name="daraja-config.txt"] contents]
:if ([:len [/file find where name="daraja-config.txt"]] > 0) do={ /file remove [find where name="daraja-config.txt"] }
:if ($configureResponse != "OK") do={ :error "Daraja setup did not receive gateway confirmation from the backend" }
:put "DARAJA_SETUP: gateway-registered"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'gateway-registered')}
:if ([:len [/system scheduler find where name="daraja-agent-scheduler"]] > 0) do={ /system scheduler remove [find where name="daraja-agent-scheduler"] }
:if ([:len [/system script find where name="daraja-agent-poll"]] > 0) do={ /system script remove [find where name="daraja-agent-poll"] }
:put "DARAJA_SETUP: poller-install-started"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'poller-install-started')}
/system script add name="daraja-agent-poll" policy=ftp,read,write,policy,test source={
    :local apiUrl "${escapedBackendUrl}/api/agents/poll"
    :local agentToken "${rawToken}"
    :global darajaLastResult
    :global darajaPollFailures
    :global darajaAgentToken
    :global darajaUninstallPending
    :if (([:typeof $darajaAgentToken] = "nothing") || ($darajaAgentToken != $agentToken)) do={
        :set darajaLastResult ""
        :set darajaPollFailures 0
        :set darajaUninstallPending false
        :set darajaAgentToken $agentToken
    }
    :if ([:typeof $darajaLastResult] = "nothing") do={ :set darajaLastResult "" }
    :if ([:typeof $darajaPollFailures] = "nothing") do={ :set darajaPollFailures 0 }
    :if ([:typeof $darajaUninstallPending] = "nothing") do={ :set darajaUninstallPending false }
    :local authHeader ("X-Agent-Token: " . $agentToken)
    :local fetchFailed false
    :local response ""
    :onerror fetchError in={
        :local fetchResult [/tool fetch url=$apiUrl http-method=post \\
            http-header-field=($authHeader . ",Content-Type: text/plain") \\
            http-data=$darajaLastResult as-value output=user]
        :if (($fetchResult->"status") != "finished") do={ :error "Agent poll fetch did not finish" }
        :set response ($fetchResult->"data")
    } do={
        :set fetchFailed true
        :set darajaPollFailures ($darajaPollFailures + 1)
        :if (($darajaPollFailures = 1) || (($darajaPollFailures % 10) = 0)) do={
            :log warning ("Daraja agent poll failed (" . $darajaPollFailures . " consecutive): " . $fetchError)
        }
    }
    :if (!$fetchFailed) do={
        :if ($darajaPollFailures > 0) do={
            :log info ("Daraja agent poll recovered after " . $darajaPollFailures . " failure(s)")
        }
        :set darajaPollFailures 0
        :set darajaLastResult ""
        :if ($response = "UNINSTALL_COMPLETE") do={
            :if ($darajaUninstallPending) do={
                :local completionFailed false
                :onerror completionError in={
                    :local completionResponse [/tool fetch url="${escapedBackendUrl}/api/agents/uninstall-complete" http-method=post \\
                        http-header-field=("X-Agent-Token: " . $agentToken . ",Content-Type: text/plain") \\
                        http-data="complete" as-value output=user]
                    :if (($completionResponse->"status") != "finished") do={ :error "Uninstall completion request did not finish" }
                    :if (($completionResponse->"data") != "OK") do={ :error "Uninstall completion was not confirmed by the backend" }
                } do={
                    :set completionFailed true
                    :log warning ("Daraja uninstall finalization failed: " . $completionError)
                }
                :if (!$completionFailed) do={
                    :if ([:len [/system scheduler find where name="daraja-agent-scheduler"]] > 0) do={ /system scheduler remove [find where name="daraja-agent-scheduler"] }
                    :if ([:len [/system script find where name="daraja-agent-poll"]] > 0) do={ /system script remove [find where name="daraja-agent-poll"] }
                    :set darajaLastResult ""
                    :set darajaPollFailures 0
                    :set darajaAgentToken ""
                    :set darajaUninstallPending false
                    :put "DARAJA_SETUP: uninstall-complete"
                    :return
                }
            }
        }
        :if ($response != "NONE") do={
            :local idSeparator [:find $response ":"]
            :if ($idSeparator != nil) do={
                :local jobId [:pick $response 0 $idSeparator]
                :local command [:pick $response ($idSeparator + 1) [:len $response]]
                :local actionSeparator [:find $command ":"]
                :if (($jobId~"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\$") && ($actionSeparator != nil)) do={
                    :local action [:pick $command 0 $actionSeparator]
                    :local args [:pick $command ($actionSeparator + 1) [:len $command]]
                    :local jobResult ($jobId . ":SUCCESS:")
                    :onerror jobError in={
                        :if ($action = "CREATE_USER") do={
                            :local userSeparator [:find $args ":"]
                            :if ($userSeparator = nil) do={ :error "Invalid CREATE_USER job" }
                            :local username [:pick $args 0 $userSeparator]
                            :local remaining [:pick $args ($userSeparator + 1) [:len $args]]
                            :local passwordSeparator [:find $remaining ":"]
                            :if ($passwordSeparator = nil) do={ :error "Invalid CREATE_USER job" }
                            :local password [:pick $remaining 0 $passwordSeparator]
                            :local profile [:pick $remaining ($passwordSeparator + 1) [:len $remaining]]
                            :if ([:len [/ip hotspot user profile find where name=$profile]] = 0) do={
                                /ip hotspot user profile add name=$profile comment="Daraja Hotspot"
                            }
                            /ip hotspot user add name=$username password=$password profile=$profile comment="Daraja Hotspot"
                        } else={
                            :if (($action = "DISABLE_USER") || ($action = "ENABLE_USER")) do={
                                :local userName $args
                                :if ($action = "DISABLE_USER") do={
                                    :if ([:len [/ip hotspot active find where user=$userName]] > 0) do={ /ip hotspot active remove [find where user=$userName] }
                                    /ip hotspot user disable [find name=$userName]
                                } else={
                                    /ip hotspot user enable [find name=$userName]
                                }
                            } else={
                                :if ($action = "UNINSTALL") do={
                                    :foreach darajaUserId in=[/ip hotspot user find where comment="Daraja Hotspot"] do={
                                        :local darajaUserName [/ip hotspot user get $darajaUserId name]
                                        :if ([:len [/ip hotspot active find where user=$darajaUserName]] > 0) do={
                                            /ip hotspot active remove [find where user=$darajaUserName]
                                        }
                                        /ip hotspot user remove $darajaUserId
                                    }
                                    :if ([:len [/ip hotspot find where name="daraja-hotspot-server"]] > 0) do={
                                        /ip hotspot remove [find where name="daraja-hotspot-server"]
                                    }
                                    :if ([:len [/ip hotspot walled-garden find where comment="Daraja payment portal"]] > 0) do={
                                        /ip hotspot walled-garden remove [find where comment="Daraja payment portal"]
                                    }
                                    :if ([:len [/ip dhcp-server find where name="daraja-hotspot-dhcp"]] > 0) do={
                                        /ip dhcp-server remove [find where name="daraja-hotspot-dhcp"]
                                    }
                                    :if ([:len [/ip dhcp-server network find where comment="Daraja Hotspot"]] > 0) do={
                                        /ip dhcp-server network remove [find where comment="Daraja Hotspot"]
                                    }
                                    :if ([:len [/ip address find where comment="Daraja Hotspot"]] > 0) do={
                                        /ip address remove [find where comment="Daraja Hotspot"]
                                    }
                                    :if ([:len [/ip pool find where name="daraja-hotspot-pool"]] > 0) do={
                                        :if ([:len [/ip dhcp-server find where address-pool="daraja-hotspot-pool"]] = 0) do={
                                            /ip pool remove [find where name="daraja-hotspot-pool"]
                                        }
                                    }
                                    :if ([:len [/ip hotspot profile find where name="daraja-hotspot-profile"]] > 0) do={
                                        :if ([:len [/ip hotspot find where profile="daraja-hotspot-profile"]] = 0) do={
                                            /ip hotspot profile remove [find where name="daraja-hotspot-profile"]
                                        }
                                    }
                                    :foreach darajaProfileId in=[/ip hotspot user profile find where comment="Daraja Hotspot"] do={
                                        :local darajaProfileName [/ip hotspot user profile get $darajaProfileId name]
                                        :if ([:len [/ip hotspot user find where profile=$darajaProfileName]] = 0) do={
                                            /ip hotspot user profile remove $darajaProfileId
                                        }
                                    }
                                    :local darajaPortalFile [/file find where name="hotspot/login.html"]
                                    :if ([:len $darajaPortalFile] > 0) do={
                                        :local darajaPortalContents [/file get ($darajaPortalFile->0) contents]
                                        :if ([:find $darajaPortalContents "Opening the Wi-Fi payment page..."] != nil) do={
                                            /file remove $darajaPortalFile
                                        }
                                    }
                                    :set darajaUninstallPending true
                                } else={
                                    :error "Unsupported job action"
                                }
                            }
                        }
                    } do={
                        :set jobResult ($jobId . ":FAILED:" . $jobError)
                    }
                    :set darajaLastResult $jobResult
                } else={
                    :log warning "Daraja agent received malformed job response; result not submitted"
                }
            } else={
                :log warning "Daraja agent received malformed job response; result not submitted"
            }
        }
    }
}
:if ([:len [/system script find where name="daraja-agent-poll"]] = 0) do={ :error "Daraja setup stopped: agent poll script was not created; scheduler was not installed" }
/system scheduler add name="daraja-agent-scheduler" interval=30s on-event="daraja-agent-poll" policy=ftp,read,write,policy,test
:put "DARAJA_SETUP: poller-installed"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'poller-installed')}
/system script run daraja-agent-poll
:put "DARAJA_SETUP: complete"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'complete')}
`;
}

function buildRouterSetupProgressCommand(backendUrl, rawToken, stage) {
  const escapedBackendUrl = escapeRouterOsString(backendUrl);
  return `:do { :local progressResult [/tool fetch url="${escapedBackendUrl}/api/agents/setup-status" http-method=post http-header-field="X-Agent-Token: ${rawToken},Content-Type: text/plain" http-data="${stage}" as-value output=user] } on-error={ :log warning "Daraja setup progress report failed: ${stage}" }`;
}

function buildAgentHeartbeatBootstrapScript(backendUrl, rawToken) {
const escapedBackendUrl = escapeRouterOsString(backendUrl);
return `
:put "DARAJA_SETUP: heartbeat-install-started"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'heartbeat-install-started')}
:global darajaLastResult
:global darajaPollFailures
:global darajaAgentToken
:if (([:typeof $darajaAgentToken] = "nothing") || ($darajaAgentToken != "${rawToken}")) do={
    :set darajaLastResult ""
    :set darajaPollFailures 0
}
:set darajaAgentToken "${rawToken}"
:if ([:len [/system scheduler find where name="daraja-agent-scheduler"]] > 0) do={ /system scheduler remove [find where name="daraja-agent-scheduler"] }
:if ([:len [/system script find where name="daraja-agent-poll"]] > 0) do={ /system script remove [find where name="daraja-agent-poll"] }
/system script add name="daraja-agent-poll" policy=ftp,read,write,policy,test source={
  :local apiUrl "${escapedBackendUrl}/api/agents/heartbeat"
  :local authHeader ("X-Agent-Token: ${rawToken}")
  :global darajaAgentToken
  :set darajaAgentToken "${rawToken}"
  :local heartbeatSucceeded false
  :local heartbeatAttempt 0
  :while (($heartbeatAttempt < 3) && (!$heartbeatSucceeded)) do={
      :set heartbeatAttempt ($heartbeatAttempt + 1)
      :onerror heartbeatError in={
          :local heartbeatResult [/tool fetch url=$apiUrl http-method=post \\
              http-header-field=($authHeader . ",Content-Type: text/plain") \\
              http-data="PING" as-value output=user]
          :if (($heartbeatResult->"status") != "finished") do={ :error "Heartbeat fetch did not finish" }
          :set heartbeatSucceeded true
      } do={
          :put ("DARAJA_SETUP: heartbeat-fetch-error attempt " . $heartbeatAttempt . " " . $heartbeatError)
          :if ($heartbeatAttempt < 3) do={ :delay 2s }
      }
  }
  :if (!$heartbeatSucceeded) do={
      :put "DARAJA_SETUP: heartbeat-unavailable-continuing"
      :log warning "Daraja setup heartbeat failed after 3 attempts; continuing installation"
  } else={
      :put ("DARAJA_SETUP: heartbeat-fetch-succeeded attempt " . $heartbeatAttempt)
  }
}
:if ([:len [/system script find where name="daraja-agent-poll"]] = 0) do={ :error "Daraja setup stopped: heartbeat script was not created" }
/system script run daraja-agent-poll
`;
}

function buildRouterDiscoveryScript(backendUrl, rawToken, routerName, requestedInterface = '') {
  const escapedBackendUrl = escapeRouterOsString(backendUrl);
  const escapedRequestedInterface = escapeRouterOsString(requestedInterface);
  const routerLabel = routerName.replace(/[\r\n]/g, ' ');
  return `
# DARAJA HOTSPOT AUTO-DISCOVERY - ${routerLabel}
:local requestedHotspotInterface "${escapedRequestedInterface}"
:put "DARAJA_SETUP: discovery-started"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'discovery-started')}
:local wanInterfaces ","
:foreach clientId in=[/ip dhcp-client find where disabled=no] do={
    :local wanInterface [/ip dhcp-client get $clientId interface]
    :set wanInterfaces ($wanInterfaces . $wanInterface . ",")
}
:put "DARAJA_SETUP: dhcp-client-scan-complete"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'dhcp-client-scan-complete')}
:put "DARAJA_SETUP: default-route-scan-started"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'default-route-scan-started')}
:local activeDefaultRoutes [/ip route find where dst-address="0.0.0.0/0" and active]
:put ("DARAJA_SETUP: active-default-routes " . [:len $activeDefaultRoutes])
:foreach routeId in=$activeDefaultRoutes do={
    :put "DARAJA_SETUP: default-route-entry"
    :local immediateGateway [/ip route get $routeId immediate-gw]
    :put "DARAJA_SETUP: default-route-gateway-read"
    :local immediateGateways [:toarray $immediateGateway]
    :foreach gatewayEntry in=$immediateGateways do={
        :local interfaceSeparator [:find $gatewayEntry "%"]
        :if ($interfaceSeparator != nil) do={
            :local wanInterface [:pick $gatewayEntry ($interfaceSeparator + 1) [:len $gatewayEntry]]
            :if ([:len $wanInterface] > 0) do={
                :set wanInterfaces ($wanInterfaces . $wanInterface . ",")
            }
        }
    }
    :put "DARAJA_SETUP: default-route-entry-parsed"
    :put "DARAJA_SETUP: default-route-entry-complete"
}
:put "DARAJA_SETUP: default-route-scan-complete"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'default-route-scan-complete')}
:local candidateCount 0
:local hotspotInterface ""
:local candidateList ""
:if ([:len $requestedHotspotInterface] > 0) do={
    :if ([:len [/interface find where name=$requestedHotspotInterface and disabled=no]] = 0) do={
        :error "Daraja setup stopped: selected customer LAN interface was not found or is disabled"
    }
    :local selectedInterfaceIsWan false
    :foreach clientId in=[/ip dhcp-client find where disabled=no and interface=$requestedHotspotInterface] do={
        :set selectedInterfaceIsWan true
    }
    :foreach routeId in=[/ip route find where dst-address="0.0.0.0/0" and active] do={
        :local immediateGateway [/ip route get $routeId immediate-gw]
        :local interfaceMatch [:find $immediateGateway ("%" . $requestedHotspotInterface)]
        :if ($interfaceMatch != nil) do={
            :local suffixPosition ($interfaceMatch + [:len $requestedHotspotInterface] + 1)
            :if ($suffixPosition = [:len $immediateGateway]) do={
                :set selectedInterfaceIsWan true
            } else={
                :if ([:pick $immediateGateway $suffixPosition ($suffixPosition + 1)] = ",") do={
                    :set selectedInterfaceIsWan true
                }
            }
        }
    }
    :if ($selectedInterfaceIsWan) do={
        :error "Daraja setup stopped: selected customer LAN interface is also used by the WAN"
    }
    :if ([:len [/interface bridge find where name=$requestedHotspotInterface]] > 0) do={
        :foreach portId in=[/interface bridge port find where bridge=$requestedHotspotInterface] do={
            :local memberInterface [/interface bridge port get $portId interface]
            :if ([:find $wanInterfaces ("," . $memberInterface . ",")] != nil) do={
                :error "Daraja setup stopped: selected customer LAN bridge contains a WAN interface"
            }
        }
    } else={
        :if ([:len [/interface ethernet find where name=$requestedHotspotInterface]] > 0) do={
            :if ([:len [/interface bridge port find where interface=$requestedHotspotInterface]] > 0) do={
                :error "Daraja setup stopped: select the bridge, not a bridged Ethernet port"
            }
        }
    }
    :set candidateCount 1
    :set hotspotInterface $requestedHotspotInterface
    :set candidateList (" " . $requestedHotspotInterface)
}
:foreach bridgeId in=[/interface bridge find where disabled=no] do={
    :if ([:len $requestedHotspotInterface] = 0) do={
    :local candidate [/interface bridge get $bridgeId name]
    :local bridgeContainsWan false
    :foreach portId in=[/interface bridge port find where bridge=$candidate] do={
        :local memberInterface [/interface bridge port get $portId interface]
        :if ([:find $wanInterfaces ("," . $memberInterface . ",")] != nil) do={ :set bridgeContainsWan true }
    }
    :if ((!$bridgeContainsWan) && ([:find $wanInterfaces ("," . $candidate . ",")] = nil)) do={
        :set candidateCount ($candidateCount + 1)
        :set hotspotInterface $candidate
        :set candidateList ($candidateList . " " . $candidate)
    }
    }
}
:put "DARAJA_SETUP: bridge-scan-complete"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'bridge-scan-complete')}
:foreach interfaceId in=[/interface ethernet find where disabled=no] do={
    :if ([:len $requestedHotspotInterface] = 0) do={
    :local candidate [/interface ethernet get $interfaceId name]
    :local bridgePortCount [:len [/interface bridge port find where interface=$candidate]]
    :if (([:find $wanInterfaces ("," . $candidate . ",")] = nil) && ($bridgePortCount = 0)) do={
        :set candidateCount ($candidateCount + 1)
        :set hotspotInterface $candidate
        :set candidateList ($candidateList . " " . $candidate)
    }
    }
}
:put "DARAJA_SETUP: ethernet-scan-complete"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'ethernet-scan-complete')}
:if ($candidateCount != 1) do={
    :put ("Daraja could not safely identify one customer LAN interface. Candidates:" . $candidateList)
    :error "Daraja setup stopped: LAN interface detection was ambiguous; use a dedicated LAN interface and retry"
}
:put "DARAJA_SETUP: lan-interface-selected"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'lan-interface-selected')}
:if ($hotspotInterface~"[^a-zA-Z0-9_.-]") do={ :error "Daraja setup stopped: detected interface name needs manual setup" }
:local hotspotGatewayAddress ""
:local selectedAddresses [/ip address find where interface=$hotspotInterface]
:if ([:len $selectedAddresses] > 1) do={ :error "Daraja setup stopped: selected LAN has multiple IP addresses; choose one gateway manually" }
:if (([:len $selectedAddresses] = 0) && ([:len [/ip dhcp-server find where interface=$hotspotInterface]] > 0)) do={ :error "Daraja setup stopped: LAN already has a DHCP server but no gateway IP; configure its gateway first" }
:if ([:len $selectedAddresses] = 1) do={
    :local selectedAddress [/ip address get ($selectedAddresses->0) address]
    :local slashPosition [:find $selectedAddress "/"]
    :local prefixLength [:pick $selectedAddress ($slashPosition + 1) [:len $selectedAddress]]
    :if ($prefixLength != "24") do={ :error "Daraja setup stopped: detected LAN address is not a /24; use a /24 customer LAN" }
    :set hotspotGatewayAddress [:pick $selectedAddress 0 $slashPosition]
} else={
    :local subnetOptions {88;89;90;91;92;93;94;95;96;97;98;99}
    :foreach subnetThird in=$subnetOptions do={
        :local subnetPrefix ("192.168." . $subnetThird . ".")
        :local networkAddress ("192.168." . $subnetThird . ".0/24")
        :local conflict false
        :foreach addressId in=[/ip address find] do={
            :local existingAddress [/ip address get $addressId address]
            :local slashPosition [:find $existingAddress "/"]
            :local existingIp [:pick $existingAddress 0 $slashPosition]
            :local prefixLength [:tonum [:pick $existingAddress ($slashPosition + 1) [:len $existingAddress]]]
            :if (([:find $existingIp $subnetPrefix] = 0) || (($prefixLength < 24) && ([:find $existingIp "192."] = 0))) do={ :set conflict true }
        }
        :foreach networkId in=[/ip dhcp-server network find] do={
            :local existingNetwork [/ip dhcp-server network get $networkId address]
            :local slashPosition [:find $existingNetwork "/"]
            :if ($slashPosition != nil) do={
                :local existingBase [:pick $existingNetwork 0 $slashPosition]
                :local existingPrefix [:tonum [:pick $existingNetwork ($slashPosition + 1) [:len $existingNetwork]]]
                :if (($existingNetwork = $networkAddress) || (($existingPrefix < 24) && ([:find $existingBase "192.168."] = 0))) do={ :set conflict true }
            }
        }
        :if ((!$conflict) && ([:len $hotspotGatewayAddress] = 0)) do={
            :set hotspotGatewayAddress ("192.168." . $subnetThird . ".1")
        }
    }
    :if ([:len $hotspotGatewayAddress] = 0) do={ :error "Daraja setup stopped: no unused automatic 192.168.x.0/24 LAN subnet found" }
}
:put "DARAJA_SETUP: gateway-selected"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'gateway-selected')}
:put ("Daraja detected customer LAN " . $hotspotInterface . " with gateway " . $hotspotGatewayAddress)
:put "DARAJA_SETUP: lan-detected"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'lan-detected')}
:local installUrl ("${escapedBackendUrl}/api/agents/install?interface=" . $hotspotInterface . "&gateway=" . $hotspotGatewayAddress)
:if ([:len [/file find where name="daraja-setup-final.rsc"]] > 0) do={ /file remove [find where name="daraja-setup-final.rsc"] }
:put "DARAJA_SETUP: install-download-started"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'install-download-started')}
:local fetchFailed false
:onerror fetchError in={
    /tool fetch url=$installUrl http-header-field="X-Agent-Token: ${rawToken}" dst-path="daraja-setup-final.rsc"
} do={
    :set fetchFailed true
    :put ("DARAJA_SETUP: install-fetch-error " . $fetchError)
}
:if ($fetchFailed) do={ :error "Daraja could not download the router setup; see install-fetch-error above. Check the router clock, RouterOS HTTPS/TLS support, and the backend certificate chain" }
:put "DARAJA_SETUP: install-file-downloaded"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'install-file-downloaded')}
:put "DARAJA_SETUP: install-import-started"
${buildRouterSetupProgressCommand(backendUrl, rawToken, 'install-import-started')}
/import file-name="daraja-setup-final.rsc"
:if ([:len [/file find where name="daraja-setup-final.rsc"]] > 0) do={ /file remove [find where name="daraja-setup-final.rsc"] }
`;
}

function createRouterBootstrapCommand(backendUrl, rawToken, requestedInterface = '') {
  const discoverUrl = new URL(`${backendUrl}/api/agents/discover`);
  if (requestedInterface) discoverUrl.searchParams.set('interface', requestedInterface);
  const installUrl = escapeRouterOsString(discoverUrl.toString());
  return `/tool fetch url="${installUrl}" http-header-field="X-Agent-Token: ${rawToken}" dst-path="daraja-setup.rsc"; /import file-name="daraja-setup.rsc"; /file remove [find name="daraja-setup.rsc"]`;
}

function validateHotspotInterface(value) {
  const interfaceName = typeof value === 'string' ? value.trim() : '';
  if (!interfaceName) throw new Error('Router hotspot interface is required');
  if (interfaceName.length > 64 || /[^a-zA-Z0-9_.-]/.test(interfaceName)) {
    throw new Error('Router hotspot interface name is invalid');
  }
  return interfaceName;
}

function validateHotspotGateway(value) {
  const address = typeof value === 'string' ? value.trim() : '';
  if (net.isIP(address) !== 4) throw new Error('Router hotspot gateway must be a valid IPv4 address');
  const fourth = Number(address.split('.')[3]);
  if (fourth < 1 || fourth > 254) {
    throw new Error('Router hotspot gateway must use a host address from .1 to .254');
  }
  return address;
}

function validateProfiles(profiles) {
  if (profiles.some(profile => typeof profile !== 'string'
      || profile.length > 64 || /[:\u0000-\u001f\u007f]/.test(profile))) {
    throw new Error('Router setup cannot include a bundle profile with invalid characters');
  }
}

function getBackendUrl() {
  try {
    const parsedBackendUrl = new URL(process.env.BACKEND_URL || '');
    if (!['http:', 'https:'].includes(parsedBackendUrl.protocol)
        || parsedBackendUrl.username
        || parsedBackendUrl.password
        || parsedBackendUrl.search
        || parsedBackendUrl.hash) {
      throw new Error('Invalid backend URL');
    }
    return { backendUrl: parsedBackendUrl.toString().replace(/\/+$/, '') };
  } catch {
    throw new Error('BACKEND_URL must be a valid HTTP(S) URL reachable from the MikroTik router');
  }
}

function getPoolRanges(subnet, gatewayHost) {
  const ranges = [];
  const firstHost = Math.max(10, gatewayHost === 10 ? 11 : 10);
  const lastHost = Math.min(254, gatewayHost === 254 ? 253 : 254);
  if (gatewayHost < lastHost && firstHost <= lastHost) {
    ranges.push(`${subnet}.${Math.max(firstHost, gatewayHost + 1)}-${subnet}.${lastHost}`);
  }
  if (gatewayHost > firstHost) {
    ranges.unshift(`${subnet}.${firstHost}-${subnet}.${Math.min(lastHost, gatewayHost - 1)}`);
  }
  return ranges.join(',');
}

function escapeRouterOsString(value) {
  return value.replace(/[\\"]|\$/g, character => `\\${character}`);
}

function escapeHtmlAttribute(value) {
  return value.replace(/[&"<>']/g, character => ({
    '&': '&amp;',
    '"': '&quot;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;'
  })[character]);
}

exports.updateRouter = async (tenantId, routerId, data) => {
  data = data || {};
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const localIp = typeof data.localIp === 'string' ? data.localIp.trim() : '';
  if (!name || net.isIP(localIp) !== 4) {
    throw new Error('Router name and a valid IPv4 hotspot gateway are required');
  }
  if (data.active !== undefined && typeof data.active !== 'boolean') {
    throw new Error('Router active status must be a boolean');
  }
  const updated = await adminRepo.updateRouter(
    tenantId, routerId, name, localIp, data.active
  );
  if (!updated) throw new Error('Router not found');
  return updated;
};

exports.archiveRouter = async (tenantId, routerId) => {
  const archived = await adminRepo.archiveRouter(tenantId, routerId);
  if (!archived) throw new Error('Router not found');
  return archived;
};

exports.deleteRouters = async (tenantId, routerIds) => {
  if (!Array.isArray(routerIds) || routerIds.length === 0) {
    throw new Error('Select at least one router to delete');
  }
  const uniqueIds = [...new Set(routerIds)];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uniqueIds.some(id => typeof id !== 'string' || !uuidPattern.test(id))) {
    throw new Error('Router selection contains an invalid router ID');
  }

  const result = await adminRepo.deleteRouters(tenantId, uniqueIds);
  if (result.blockedRouters.length) {
    throw new Error(
      `Routers with payment history cannot be deleted: ${result.blockedRouters.join(', ')}. Archive them instead.`
    );
  }
  return result;
};

function validatePlan(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Plan fields are required');
  }
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const profile = typeof data.profile === 'string' ? data.profile.trim() : '';
  const price = Number(data.price);
  const durationMin = Number(data.durationMin);

  if (!name || !profile) throw new Error('Plan name and profile are required');
  if (profile.length > 64 || /[:\u0000-\u001f\u007f]/.test(profile)) {
    throw new Error('Plan profile contains invalid characters');
  }
  if (!Number.isFinite(price) || price <= 0
      || !Number.isInteger(durationMin) || durationMin <= 0) {
    throw new Error('Plan price and duration must be positive numbers');
  }

  return { name, price, durationMin, profile };
}
