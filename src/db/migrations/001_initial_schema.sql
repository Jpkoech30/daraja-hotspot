-- 001_initial_schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. ENUMS
CREATE TYPE tenant_status AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE router_health AS ENUM ('ONLINE', 'OFFLINE', 'UNHEALTHY');
CREATE TYPE pay_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');
CREATE TYPE job_action AS ENUM ('CREATE_USER', 'DISABLE_USER', 'ENABLE_USER');
CREATE TYPE job_status AS ENUM ('PENDING', 'CLAIMED', 'SUCCESS', 'FAILED');

-- 2. HELPERS
CREATE OR REPLACE FUNCTION update_modified_column() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW; 
END;
$$ language 'plpgsql';

-- 3. SUBSCRIPTION PLANS (Your SaaS Tiers)
CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  max_active_users INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. TENANTS (The Mini-ISPs)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  status tenant_status NOT NULL DEFAULT 'ACTIVE',
  subscription_plan_id UUID REFERENCES subscription_plans(id),
  subscription_expires_at TIMESTAMPTZ,
  is_subscription_active BOOLEAN DEFAULT FALSE,
  
  -- BYOK Encrypted Keys
  mpesa_shortcode TEXT,
  mpesa_key_enc TEXT,        
  mpesa_secret_enc TEXT,     
  mpesa_passkey_enc TEXT,    
  airtel_client_id_enc TEXT,
  airtel_secret_enc TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER update_tenants_modtime BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- 5. PLATFORM INVOICES (Billing the ISP)
CREATE TABLE platform_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  checkout_id TEXT UNIQUE NOT NULL, 
  receipt TEXT,                     
  amount NUMERIC(10,2) NOT NULL,
  status pay_status NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER update_platform_invoices_modtime BEFORE UPDATE ON platform_invoices FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- 6. ROUTERS (MikroTik Devices)
CREATE TABLE routers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  local_ip TEXT NOT NULL,
  agent_token_hash TEXT NOT NULL,   
  health router_health NOT NULL DEFAULT 'OFFLINE',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_routers_tenant ON routers(tenant_id);

-- 7. BOOTSTRAP TOKENS (For the One-Line Setup)
CREATE TABLE bootstrap_tokens (
  token TEXT PRIMARY KEY,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_token_enc TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. HOTSPOT PLANS (What end-users buy)
CREATE TABLE hotspot_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,              
  price NUMERIC(10,2) NOT NULL CHECK (price > 0),
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  mikrotik_profile TEXT NOT NULL,  
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_plans_tenant ON hotspot_plans(tenant_id) WHERE active = TRUE;

-- 9. TRANSACTIONS (End-user payments)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  router_id UUID NOT NULL REFERENCES routers(id),
  plan_id UUID NOT NULL REFERENCES hotspot_plans(id),
  provider TEXT NOT NULL,           
  checkout_id TEXT UNIQUE NOT NULL,
  receipt TEXT,                     
  phone TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  mac_address TEXT,
  status pay_status NOT NULL DEFAULT 'PENDING',
  raw_callback JSONB,               
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tx_checkout ON transactions(checkout_id);
CREATE INDEX idx_tx_tenant_date ON transactions(tenant_id, created_at DESC);
CREATE INDEX idx_tx_pending ON transactions(status) WHERE status = 'PENDING';
CREATE TRIGGER update_tx_modtime BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- 10. PROVISIONING JOBS (Queue for MikroTik Agents)
CREATE TABLE provisioning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  action job_action NOT NULL,
  payload JSONB NOT NULL,           
  status job_status NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_jobs_polling ON provisioning_jobs(router_id, created_at) WHERE status = 'PENDING';

-- 11. HOTSPOT USERS (Tracks active connections & limits)
CREATE TABLE hotspot_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  mac_address TEXT,
  plan_id UUID NOT NULL REFERENCES hotspot_plans(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (router_id, username)
);
CREATE INDEX idx_users_expiry ON hotspot_users(expires_at);
CREATE INDEX idx_users_tenant ON hotspot_users(tenant_id);