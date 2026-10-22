-- 002_seed_data.sql

-- 1. Insert Subscription Tiers
INSERT INTO subscription_plans (id, name, price, max_active_users) VALUES 
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Starter', 100.00, 50),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Growth', 250.00, 100),
('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Pro', 500.00, NULL);

-- 2. Insert Test Tenant (ISP)
INSERT INTO tenants (
    id, name, email, subscription_plan_id, subscription_expires_at, is_subscription_active,
    mpesa_shortcode, mpesa_key_enc, mpesa_secret_enc, mpesa_passkey_enc
) VALUES (
    '11111111-1111-1111-1111-111111111111', 
    'Eldoret Fast Net', 
    'admin@eldoretfast.co.ke',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -- Starter Plan
    NOW() + INTERVAL '30 days',
    TRUE,
    '174379',
    'dummy_encrypted_key',
    'dummy_encrypted_secret',
    'dummy_encrypted_passkey'
);

-- 3. Insert Test Router
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

-- 4. Insert Test Hotspot Plans
INSERT INTO hotspot_plans (
    id, tenant_id, name, price, duration_min, mikrotik_profile
) VALUES 
('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '1 Hour Bundle', 20.00, 60, '1hour'),
('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '3 Hour Bundle', 50.00, 180, '3hour'),
('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Daily Bundle', 150.00, 1440, '1day');