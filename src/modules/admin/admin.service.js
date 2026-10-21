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
  // 1. Generate a unique agent token
  const rawToken = `rt_${crypto.randomBytes(16).toString('hex')}`;
  
  // 2. Hash it for the database
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // 3. Save the router in the DB
  const router = await adminRepo.createRouter(tenantId, routerName, localIp, tokenHash);

  // 4. Generate the RouterOS script
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000'; 
  
  const script = `
# ==========================================
# DARAJA HOTSPOT AGENT - ${router.name}
# ==========================================
/system script add name="daraja-agent-poll" policy=read,write,policy,test,api source={
    :local apiUrl "${backendUrl}/api/agents/poll"
    :local agentToken "${rawToken}"
    
    /tool fetch url=$apiUrl mode=https http-method=post \\
        http-header-field="Content-Type: application/json" \\
        http-data="{\\"agentToken\\":\\"$agentToken\\"}" \\
        dst-path="agent-res.json"
    
    :local fileContent [/file get [/file find name="agent-res.json"] contents]
    
    :if ([:len $fileContent] > 0) do={
        :local json [:deserialize from=json value=$fileContent]
        :local job ($json->"job")
        
        :if ([:typeof $job] != "nothing" && $job != "null") do={
            :local action ($job->"action")
            :local payload ($job->"payload")
            
            :if ($action = "CREATE_USER") do={
                :local user ($payload->"username")
                :local pass ($payload->"password")
                :local prof ($payload->"profile")
                :local mac ($payload->"macAddress")
                
                /ip hotspot user add name=$user password=$pass profile=$prof mac-address=$mac comment="Daraja Hotspot"
            }
        }
    }
    /file remove [find name="agent-res.json"]
}
/system scheduler add name="daraja-agent-scheduler" interval=30s on-event="/system script run \\"daraja-agent-poll\\"" policy=read,write,policy,test,api
# ==========================================
  `;

  return { routerId: router.id, script };
};