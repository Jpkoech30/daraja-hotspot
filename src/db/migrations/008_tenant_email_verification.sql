ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;

UPDATE tenants
SET email_verified_at = NOW()
WHERE email_verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_email_verification_token
  ON tenants (email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;
