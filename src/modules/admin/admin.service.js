const crypto = require('crypto');
const adminRepo = require('./admin.repo');
const { encrypt } = require('../../utils/crypto');

exports.saveMpesaSettings = async (tenantId, shortcode, consumerKey, consumerSecret) => {
  if (!shortcode || !consumerKey || !consumerSecret) {
    throw new Error('All M-Pesa fields are required');
  }

  const keyEnc = encrypt(consumerKey);
  const secretEnc = encrypt(consumerSecret);

  return await adminRepo.updateMpesaSettings(tenantId, shortcode, keyEnc, secretEnc);
};

exports.getDashboardStats = async (tenantId) => {
  return await adminRepo.getStats(tenantId);
};

exports.getPlans = async (tenantId) => {
  return await adminRepo.getPlans(tenantId);
};

exports.createPlan = async (tenantId, data) => {
  const { name, price, durationMin, profile } = data;

  if (!name || !price || !durationMin || !profile) {
    throw new Error('Missing required plan fields');
  }

  return await adminRepo.createPlan(tenantId, name, price, durationMin, profile);
};

exports.generateRouterScript = async (tenantId, routerName, localIp) => {
  const rawToken = `rt_${crypto.randomBytes(16).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const router = await adminRepo.createRouter(tenantId, routerName, localIp, tokenHash);
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
  const routerLabel = String(router.name).replace(/[\r\n]/g, ' ');

  const script = `
# ==========================================
# DARAJA HOTSPOT AGENT - ${routerLabel}
# ==========================================
/system script add name="daraja-agent-poll" policy=read,write,policy,test,api source={
    :local apiUrl "${backendUrl}/api/agents/poll"
    :local agentToken "${rawToken}"
    :global darajaLastResult
    :if ([:typeof $darajaLastResult] = "nothing") do={ :set darajaLastResult "" }

    :local authHeader ("X-Agent-Token: " . $agentToken)
    :local fetchFailed false
    /file remove [find name="agent-res.txt"]
    :do {
        /tool fetch url=$apiUrl http-method=post \\
            http-header-field=($authHeader . ",Content-Type: text/plain") \\
            http-data=$darajaLastResult dst-path="agent-res.txt"
    } on-error={
        :set fetchFailed true
        :log warning "Daraja agent poll failed"
    }

    :if (!$fetchFailed) do={
        :local response [/file get [find name="agent-res.txt"] contents]
        /file remove [find name="agent-res.txt"]
        :set darajaLastResult ""

        :local idSeparator [:find $response ":"]
        :if ($idSeparator != nil) do={
            :local jobId [:pick $response 0 $idSeparator]
            :local command [:pick $response ($idSeparator + 1) [:len $response]]
            :local actionSeparator [:find $command ":"]
            :if ($actionSeparator != nil) do={
                :local action [:pick $command 0 $actionSeparator]
                :local args [:pick $command ($actionSeparator + 1) [:len $command]]
                :local jobResult ($jobId . ":SUCCESS:")
                :local jobFailed false

                :do {
                    :if ($action = "CREATE_USER") do={
                        :local userSeparator [:find $args ":"]
                        :if ($userSeparator = nil) do={ :error "Invalid CREATE_USER job" }
                        :local username [:pick $args 0 $userSeparator]
                        :local remaining [:pick $args ($userSeparator + 1) [:len $args]]
                        :local passwordSeparator [:find $remaining ":"]
                        :if ($passwordSeparator = nil) do={ :error "Invalid CREATE_USER job" }
                        :local password [:pick $remaining 0 $passwordSeparator]
                        :local profile [:pick $remaining ($passwordSeparator + 1) [:len $remaining]]
                        /ip hotspot user add name=$username password=$password profile=$profile comment="Daraja Hotspot"
                    } else={
                        :if (($action = "DISABLE_USER") || ($action = "ENABLE_USER")) do={
                            :local userName $args
                            :if ($action = "DISABLE_USER") do={
                                /ip hotspot user disable [find name=$userName]
                            } else={
                                /ip hotspot user enable [find name=$userName]
                            }
                        } else={
                            :error "Unsupported job action"
                        }
                    }
                } on-error={
                    :set jobFailed true
                }

                :if ($jobFailed) do={
                    :set jobResult ($jobId . ":FAILED:RouterOS command failed")
                }
                :set darajaLastResult $jobResult
            }
        }
    }
}
/system scheduler add name="daraja-agent-scheduler" interval=30s on-event="/system script run daraja-agent-poll" policy=read,write,policy,test,api
# ==========================================
  `;

  return { routerId: router.id, script };
};
