-- ==============================================================================
-- DARAJA HOTSPOT - DATABASE SCHEMA
-- ==============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. CUSTOM ENUM TYPES
-- ==============================================================================
CREATE TYPE tenant_status AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE router_health AS ENUM ('ONLINE', 'OFFLINE', 'UNHEALTHY');
CREATE TYPE pay_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');
CREATE TYPE job_action AS ENUM ('CREATE_USER', 'DISABLE_USER', 'ENABLE_USER');
CREATE TYPE job_status AS ENUM ('PENDING', 'CLAIMED', 'SUCCESS', 'FAILED');

-- ==============================================================================
-- 2. HELPER FUNCTIONS & TRIGGERS
-- ==============================================================================

-- Function to auto-update the 'updated_at' timestamp
CREATE OR REPLACE FUNCTION update_modified_column() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW; 
END;
$$ language 'plpgsql';

-- ==============================================================================
-- 3. TABLES
-- ==============================================================================

-- TENANTS (The Mini-ISPs)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status tenant_status NOT NULL DEFAULT 'ACTIVE',
  mpesa_shortcode TEXT,
  mpesa_key_enc BYTEA,       -- AES-256 encrypted
  mpesa_secret_enc BYTEA,    -- AES-256 encrypted
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ROUTERS (The MikroTik Devices)
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

-- HOTSPOT PLANS (What the user buys)
CREATE TABLE hotspot_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price > 0), -- Prevents free/negative plans
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  mikrotik_profile TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TRANSACTIONS (M-Pesa Tracking)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  router_id UUID NOT NULL REFERENCES routers(id),
  plan_id UUID NOT NULL REFERENCES hotspot_plans(id),
  checkout_id TEXT UNIQUE NOT NULL,
  receipt TEXT,
  phone TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  mac_address TEXT,
  status pay_status NOT NULL DEFAULT 'PENDING',
  raw_callback JSONB,        -- Saves the exact Safaricom payload for audits
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PROVISIONING JOBS (The Queue for the MikroTik Agent)
CREATE TABLE provisioning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  action job_action NOT NULL,
  payload JSONB NOT NULL,    -- e.g., {"username": "u_123", "mac": "AA:BB"}
  status job_status NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- ==============================================================================
-- 4. INDEXES (For High Performance)
-- ==============================================================================

CREATE INDEX idx_routers_tenant ON routers(tenant_id);

-- Partial index: Only indexes active plans, ignoring inactive history
CREATE INDEX idx_plans_tenant ON hotspot_plans(tenant_id) WHERE active = TRUE;

-- Fast lookup for webhook callbacks checking if a transaction exists
CREATE INDEX idx_tx_checkout ON transactions(checkout_id);

-- CRITICAL: Partial index for Agent Polling. 
-- Makes searching for pending jobs instant, even with millions of completed jobs.
CREATE INDEX idx_jobs_polling ON provisioning_jobs(router_id, created_at) WHERE status = 'PENDING';

-- ==============================================================================
-- 5. APPLY TRIGGERS
-- ==============================================================================

CREATE TRIGGER update_tenants_modtime 
BEFORE UPDATE ON tenants 
FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

CREATE TRIGGER update_tx_modtime 
BEFORE UPDATE ON transactions 
FOR EACH ROW EXECUTE PROCEDURE update_modified_column();