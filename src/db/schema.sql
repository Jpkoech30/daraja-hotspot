-- src/db/schema.sql

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- 1. ENUMS (Strict Data Integrity)
-- ==========================================
CREATE TYPE tenant_status AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE router_health AS ENUM ('ONLINE', 'OFFLINE', 'UNHEALTHY');
CREATE TYPE pay_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');
CREATE TYPE job_action AS ENUM ('CREATE_USER', 'DISABLE_USER', 'ENABLE_USER');
CREATE TYPE job_status AS ENUM ('PENDING', 'CLAIMED', 'SUCCESS', 'FAILED');

-- ==========================================
-- 2. HELPER FUNCTIONS
-- ==========================================
-- Auto-update the "updated_at" column on any table that has it
CREATE OR REPLACE FUNCTION update_modified_column() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW; 
END;
$$ language 'plpgsql';

-- ==========================================
-- 3. TABLES
-- ==========================================

-- SUBSCRIPTION PLANS (Your SaaS Tiers)
CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,               -- e.g., 'Starter', 'Growth', 'Pro'
  price NUMERIC(10,2) NOT NULL,     -- e.g., 100.00
  max_active_users INTEGER,         -- e.g., 50, 100, NULL (NULL = Unlimited)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TENANTS (The Mini-ISPs)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  status tenant_status NOT NULL DEFAULT 'ACTIVE',
  
  -- SaaS Billing Info
  subscription_plan_id UUID REFERENCES subscription_plans(id),
  subscription_expires_at TIMESTAMPTZ,
  is_subscription_active BOOLEAN DEFAULT FALSE,

  -- BYOK Payment Gateway Credentials (AES-256-GCM Encrypted Strings)
  mpesa_shortcode TEXT,
  mpesa_key_enc TEXT,        -- Encrypted via your crypto utility
  mpesa_secret_enc TEXT,     -- Encrypted
  mpesa_passkey_enc TEXT,    -- Encrypted
  
  airtel_client_id_enc TEXT,
  airtel_secret_enc TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER update_tenants_modtime BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- PLATFORM INVOICES (Billing the ISP for using your platform)
CREATE TABLE platform_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  checkout_id TEXT UNIQUE NOT NULL, -- From your platform's M-Pesa STK Push
  receipt TEXT,                     -- M-Pesa Receipt Number
  amount NUMERIC(10,2) NOT NULL,
  status pay_status NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER update_platform_invoices_modtime BEFORE UPDATE ON platform_invoices FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- ROUTERS (MikroTik Devices)
CREATE TABLE routers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  local_ip TEXT NOT NULL,
  agent_token_hash TEXT NOT NULL,   -- Hashed for security
  health router_health NOT NULL DEFAULT 'OFFLINE',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_routers_tenant ON routers(tenant_id);

-- BOOTSTRAP TOKENS (For the One-Line Magic Setup)
CREATE TABLE bootstrap_tokens (
  token TEXT PRIMARY KEY,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_token_enc TEXT NOT NULL,    -- Encrypted agent token to inject into script
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HOTSPOT PLANS (What the end-user buys)
CREATE TABLE hotspot_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,               -- e.g., "1 Hour Bundle"
  price NUMERIC(10,2) NOT NULL CHECK (price > 0),
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  mikrotik_profile TEXT NOT NULL,   -- e.g., "1hour"
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_plans_tenant ON hotspot_plans(tenant_id) WHERE active = TRUE;

-- TRANSACTIONS (End-user payments to the ISP via BYOK)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  router_id UUID NOT NULL REFERENCES routers(id),
  plan_id UUID NOT NULL REFERENCES hotspot_plans(id),
  provider TEXT NOT NULL,           -- 'MPESA' or 'AIRTEL'
  checkout_id TEXT UNIQUE NOT NULL,
  receipt TEXT,                     -- M-Pesa/Airtel Receipt
  phone TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  mac_address TEXT,
  status pay_status NOT NULL DEFAULT 'PENDING',
  raw_callback JSONB,               -- Audit log of Safaricom/Airtel payload
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tx_checkout ON transactions(checkout_id);
CREATE INDEX idx_tx_tenant_date ON transactions(tenant_id, created_at DESC);
CREATE INDEX idx_tx_pending ON transactions(status) WHERE status = 'PENDING';
CREATE TRIGGER update_tx_modtime BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- PROVISIONING JOBS (The Queue for MikroTik Agents)
CREATE TABLE provisioning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  action job_action NOT NULL,
  payload JSONB NOT NULL,           -- JSON containing username, profile, etc.
  status job_status NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
-- CRITICAL INDEX: Allows the Agent to instantly find its pending jobs without locking
CREATE INDEX idx_jobs_polling ON provisioning_jobs(router_id, created_at) WHERE status = 'PENDING';

-- HOTSPOT USERS (Tracks active connections for tier limits and expiry)
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

-- ==========================================
-- 4. SEED DATA (For Local Testing)
-- ==========================================

-- 1. Insert the Subscription Tiers
INSERT INTO subscription_plans (id, name, price, max_active_users) VALUES 
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Starter', 100.00, 50),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Growth', 250.00, 100),
('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Pro', 500.00, NULL);

-- 2. Insert a Test Tenant (ISP)
INSERT INTO tenants (
    id, name, email, subscription_plan_id, subscription_expires_at, is_subscription_active
) VALUES (
    '11111111-1111-1111-1111-111111111111', 
    'Eldoret Fast Net', 
    'admin@eldoretfast.co.ke',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -- Starter Plan
    NOW() + INTERVAL '30 days',
    TRUE
);

-- 3. Insert a Test Router
INSERT INTO routers (
    id, tenant_id, name, local_ip, agent_token_hash, health
) VALUES (
    '22222222-2222-2222-2222-222222222222', 
    '11111111-1111-1111-1111-111111111111', 
    'Main Street Router', 
    '192.168.88.1', 
    'dummy_hash_for_testing',
    'ONLINE'
);

-- 4. Insert Test Hotspot Plans (What customers buy)
INSERT INTO hotspot_plans (
    id, tenant_id, name, price, duration_min, mikrotik_profile
) VALUES 
('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '1 Hour Bundle', 20.00, 60, '1hour'),
('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '3 Hour Bundle', 50.00, 180, '3hour'),
('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Daily Bundle', 150.00, 1440, '1day');