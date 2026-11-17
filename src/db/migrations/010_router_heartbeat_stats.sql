CREATE TABLE router_heartbeat_minutes (
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  bucket_at TIMESTAMPTZ NOT NULL,
  ping_count INTEGER NOT NULL DEFAULT 1 CHECK (ping_count > 0),
  PRIMARY KEY (router_id, bucket_at)
);

CREATE INDEX idx_router_heartbeat_minutes_bucket
  ON router_heartbeat_minutes (bucket_at);
