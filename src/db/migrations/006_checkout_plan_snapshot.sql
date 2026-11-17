ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS plan_duration_min INTEGER,
  ADD COLUMN IF NOT EXISTS plan_mikrotik_profile TEXT;

UPDATE transactions AS tx
SET plan_duration_min = plans.duration_min,
    plan_mikrotik_profile = plans.mikrotik_profile
FROM hotspot_plans AS plans
WHERE plans.id = tx.plan_id
  AND (tx.plan_duration_min IS NULL OR tx.plan_mikrotik_profile IS NULL);

ALTER TABLE transactions
  ALTER COLUMN plan_duration_min SET NOT NULL,
  ALTER COLUMN plan_mikrotik_profile SET NOT NULL;
