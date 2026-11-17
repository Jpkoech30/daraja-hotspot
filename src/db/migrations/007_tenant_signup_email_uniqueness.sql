CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_email_normalized
  ON tenants (LOWER(TRIM(email)));
