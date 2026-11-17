ALTER TABLE routers
  ADD COLUMN setup_stage TEXT,
  ADD COLUMN setup_updated_at TIMESTAMPTZ;
