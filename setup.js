// setup.js
require('dotenv').config();
const { pool } = require('./src/config/db');

const setupDatabase = async () => {
  try {
    console.log('⏳ Dropping old tables (if any) and creating new schema...');
    
    await pool.query(`
      DROP TABLE IF EXISTS provisioning_jobs CASCADE;
      DROP TABLE IF EXISTS transactions CASCADE;
      DROP TABLE IF EXISTS hotspot_plans CASCADE;
      DROP TABLE IF EXISTS routers CASCADE;
      DROP TABLE IF EXISTS tenants CASCADE;
      DROP TYPE IF EXISTS tenant_status CASCADE;
      DROP TYPE IF EXISTS router_health CASCADE;
      DROP TYPE IF EXISTS pay_status CASCADE;
      DROP TYPE IF EXISTS job_action CASCADE;
      DROP TYPE IF EXISTS job_status CASCADE;

      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TYPE tenant_status AS ENUM ('ACTIVE', 'SUSPENDED');
      CREATE TYPE router_health AS ENUM ('ONLINE', 'OFFLINE', 'UNHEALTHY');
      CREATE TYPE pay_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');
      CREATE TYPE job_action AS ENUM ('CREATE_USER', 'DISABLE_USER', 'ENABLE_USER');
      CREATE TYPE job_status AS ENUM ('PENDING', 'CLAIMED', 'SUCCESS', 'FAILED');

      CREATE TABLE tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        status tenant_status NOT NULL DEFAULT 'ACTIVE',
        mpesa_shortcode TEXT,
        mpesa_key_enc BYTEA,
        mpesa_secret_enc BYTEA,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

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
        raw_callback JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX idx_tx_checkout ON transactions(checkout_id);

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
    `);
    console.log('✅ Tables created successfully.');

    console.log('⏳ Inserting test data...');
    await pool.query(`
      INSERT INTO tenants (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'Eldoret Fast Net');
      
      INSERT INTO routers (id, tenant_id, name, local_ip, agent_token_hash) 
      VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Router 1', '192.168.88.1', 'dummyhash');
      
      INSERT INTO hotspot_plans (id, tenant_id, name, price, duration_min, mikrotik_profile) VALUES 
      ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '1 Hour Bundle', 20.00, 60, '1hour'),
      ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '3 Hour Bundle', 50.00, 180, '3hour');
    `);
    console.log('✅ Test data inserted.');

    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
};

setupDatabase();