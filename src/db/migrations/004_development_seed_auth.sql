UPDATE tenants
SET password_hash = '$2b$10$ouven8xpve0FEmyMaGfsMOVtsbCUSkaFbI66qvXOHnoDasv904mLi',
    mpesa_shortcode = NULL,
    mpesa_key_enc = NULL,
    mpesa_secret_enc = NULL,
    mpesa_passkey_enc = NULL
WHERE id = '11111111-1111-1111-1111-111111111111';

UPDATE routers
SET health = 'OFFLINE'
WHERE id = '22222222-2222-2222-2222-222222222222';
