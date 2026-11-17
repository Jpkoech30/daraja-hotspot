ALTER TABLE tenants
  RENAME COLUMN email_verification_token_hash TO email_verification_code_hash;

DROP INDEX IF EXISTS idx_tenants_email_verification_token;

ALTER TABLE tenants
  ADD COLUMN email_verification_attempts INTEGER NOT NULL DEFAULT 0;

UPDATE tenants
SET email_verification_code_hash = NULL,
    email_verification_expires_at = NULL
WHERE email_verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_email_verification_code
  ON tenants (email_verification_code_hash)
  WHERE email_verification_code_hash IS NOT NULL;
