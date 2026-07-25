-- Clean duplicate production runs / entries / step states created by multi-device seeding.
-- Applied to the live project on 2026-07-25 via MCP (already executed — kept for documentation).
-- Keep the earliest copy (primary device state, correct statuses), remap its FK uuids
-- to the live (kept) flows/categories/products, and soft-delete the other copies.

DO $$
DECLARE
  n int;
BEGIN

-- ============ 1) FLOW MAP: dead flow uuid -> live flow uuid ============
CREATE TEMP TABLE tmp_flow_map (dead text PRIMARY KEY, live text) ON COMMIT DROP;

-- 1a. votes from duplicate-run pairs (same date+batch, one copy has live flow)
WITH live_runs AS (
  SELECT id, payload, updated_at,
    (payload->>'date') || '|' || coalesce(payload->>'batchNumber','') AS grp
  FROM sync_production_runs WHERE deleted_at IS NULL
),
keep AS (
  SELECT DISTINCT ON (grp) grp, id AS keep_id, payload AS keep_payload
  FROM live_runs ORDER BY grp, updated_at ASC, id ASC
),
pairs AS (
  SELECT k.keep_payload->>'flowId' AS dead_flow, r.payload->>'flowId' AS live_flow
  FROM live_runs r JOIN keep k ON k.grp = r.grp AND r.id <> k.keep_id
),
votes AS (
  SELECT dead_flow, live_flow, count(*) AS c
  FROM pairs p
  WHERE EXISTS (SELECT 1 FROM sync_flows f WHERE f.id::text = p.live_flow AND f.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM sync_flows f WHERE f.id::text = p.dead_flow AND f.deleted_at IS NULL)
  GROUP BY 1,2
),
best AS (
  SELECT DISTINCT ON (dead_flow) dead_flow, live_flow
  FROM votes ORDER BY dead_flow, c DESC
)
INSERT INTO tmp_flow_map SELECT dead_flow, live_flow FROM best;

-- 1b. fallback for dead flows without pair votes: match by run-step-name overlap
WITH dead_flows AS (
  SELECT DISTINCT r.payload->>'flowId' AS dead
  FROM sync_production_runs r
  WHERE r.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM sync_flows f WHERE f.id::text = r.payload->>'flowId' AND f.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM tmp_flow_map m WHERE m.dead = r.payload->>'flowId')
),
dead_steps AS (
  SELECT df.dead, lower(s.payload->>'stepName') AS step_name
  FROM dead_flows df
  JOIN sync_production_runs r ON r.payload->>'flowId' = df.dead AND r.deleted_at IS NULL
  JOIN sync_run_step_states s ON s.payload->>'runId' = r.id::text AND s.deleted_at IS NULL
  GROUP BY 1,2
),
live_steps AS (
  SELECT fs.payload->>'flowId' AS live, lower(fs.payload->>'name') AS step_name
  FROM sync_flow_steps fs
  JOIN sync_flows f ON f.id::text = fs.payload->>'flowId' AND f.deleted_at IS NULL
  WHERE fs.deleted_at IS NULL
  GROUP BY 1,2
),
scores AS (
  SELECT d.dead, l.live, count(*) AS c
  FROM dead_steps d JOIN live_steps l USING (step_name)
  GROUP BY 1,2
),
best AS (
  SELECT DISTINCT ON (dead) dead, live FROM scores ORDER BY dead, c DESC
)
INSERT INTO tmp_flow_map SELECT dead, live FROM best
ON CONFLICT (dead) DO NOTHING;

-- ============ 2) CATEGORY MAP from duplicate-run pairs ============
CREATE TEMP TABLE tmp_cat_map (dead text PRIMARY KEY, live text) ON COMMIT DROP;
WITH live_runs AS (
  SELECT id, payload, updated_at,
    (payload->>'date') || '|' || coalesce(payload->>'batchNumber','') AS grp
  FROM sync_production_runs WHERE deleted_at IS NULL
),
keep AS (
  SELECT DISTINCT ON (grp) grp, id AS keep_id, payload AS keep_payload
  FROM live_runs ORDER BY grp, updated_at ASC, id ASC
),
pairs AS (
  SELECT k.keep_payload->>'categoryId' AS dead_cat, r.payload->>'categoryId' AS live_cat
  FROM live_runs r JOIN keep k ON k.grp = r.grp AND r.id <> k.keep_id
),
votes AS (
  SELECT dead_cat, live_cat, count(*) AS c
  FROM pairs p
  WHERE EXISTS (SELECT 1 FROM sync_categories x WHERE x.id::text = p.live_cat AND x.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM sync_categories x WHERE x.id::text = p.dead_cat AND x.deleted_at IS NULL)
  GROUP BY 1,2
),
best AS (
  SELECT DISTINCT ON (dead_cat) dead_cat, live_cat FROM votes ORDER BY dead_cat, c DESC
)
INSERT INTO tmp_cat_map SELECT dead_cat, live_cat FROM best;

-- ============ 3) PRODUCT MAP from matching production entries ============
CREATE TEMP TABLE tmp_prod_map (dead text PRIMARY KEY, live text) ON COMMIT DROP;
WITH entry_votes AS (
  SELECT a.payload->>'productId' AS dead, b.payload->>'productId' AS live, count(*) AS c
  FROM sync_production_entries a
  JOIN sync_production_entries b
    ON a.payload->>'date' = b.payload->>'date'
   AND a.payload->>'quantity' = b.payload->>'quantity'
   AND a.id <> b.id
  WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM sync_products p WHERE p.id::text = b.payload->>'productId' AND p.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM sync_products p WHERE p.id::text = a.payload->>'productId' AND p.deleted_at IS NULL)
  GROUP BY 1,2
),
ranked AS (
  SELECT dead, live, c,
    row_number() OVER (PARTITION BY dead ORDER BY c DESC) AS rk
  FROM entry_votes
),
second_best AS (
  SELECT dead, max(c) AS c2 FROM ranked WHERE rk > 1 GROUP BY dead
)
INSERT INTO tmp_prod_map
SELECT r.dead, r.live FROM ranked r
LEFT JOIN second_best s ON s.dead = r.dead
WHERE r.rk = 1 AND (s.c2 IS NULL OR r.c > s.c2);

-- ============ 4) RUN DEDUPE: group by (date, batch, mapped flow) ============
CREATE TEMP TABLE tmp_run_map (drop_id uuid PRIMARY KEY, keep_id uuid) ON COMMIT DROP;
WITH live_runs AS (
  SELECT id, updated_at,
    (payload->>'date') || '|' || coalesce(payload->>'batchNumber','') || '|' ||
    coalesce((SELECT m.live FROM tmp_flow_map m WHERE m.dead = payload->>'flowId'), coalesce(payload->>'flowId','')) AS grp
  FROM sync_production_runs WHERE deleted_at IS NULL
),
keep AS (
  SELECT DISTINCT ON (grp) grp, id AS keep_id
  FROM live_runs ORDER BY grp, updated_at ASC, id ASC
)
INSERT INTO tmp_run_map
SELECT r.id, k.keep_id
FROM live_runs r JOIN keep k ON k.grp = r.grp AND r.id <> k.keep_id;

UPDATE sync_production_runs t
SET deleted_at = now(), updated_at = now()
FROM tmp_run_map m WHERE t.id = m.drop_id;
GET DIAGNOSTICS n = ROW_COUNT;
RAISE NOTICE 'runs soft-deleted: %', n;

-- ============ 5) REMAP runId on children to the kept run ============
UPDATE sync_run_step_states t
SET payload = jsonb_set(t.payload, ARRAY['runId'], to_jsonb(m.keep_id::text), true), updated_at = now()
FROM tmp_run_map m WHERE t.deleted_at IS NULL AND t.payload->>'runId' = m.drop_id::text;

UPDATE sync_production_entries t
SET payload = jsonb_set(t.payload, ARRAY['runId'], to_jsonb(m.keep_id::text), true), updated_at = now()
FROM tmp_run_map m WHERE t.deleted_at IS NULL AND t.payload->>'runId' = m.drop_id::text;

UPDATE sync_run_preparation_checks t
SET payload = jsonb_set(t.payload, ARRAY['runId'], to_jsonb(m.keep_id::text), true), updated_at = now()
FROM tmp_run_map m WHERE t.deleted_at IS NULL AND t.payload->>'runId' = m.drop_id::text;

UPDATE sync_run_cleaning_checks t
SET payload = jsonb_set(t.payload, ARRAY['runId'], to_jsonb(m.keep_id::text), true), updated_at = now()
FROM tmp_run_map m WHERE t.deleted_at IS NULL AND t.payload->>'runId' = m.drop_id::text;

-- ============ 6) REMAP kept rows' FK uuids to live universe ============
UPDATE sync_production_runs t
SET payload = jsonb_set(t.payload, ARRAY['flowId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_flow_map m WHERE t.deleted_at IS NULL AND t.payload->>'flowId' = m.dead;

UPDATE sync_production_runs t
SET payload = jsonb_set(t.payload, ARRAY['categoryId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_cat_map m WHERE t.deleted_at IS NULL AND t.payload->>'categoryId' = m.dead;

UPDATE sync_production_runs t
SET payload = jsonb_set(t.payload, ARRAY['productId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_prod_map m WHERE t.deleted_at IS NULL AND t.payload->>'productId' = m.dead;

UPDATE sync_production_entries t
SET payload = jsonb_set(t.payload, ARRAY['productId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_prod_map m WHERE t.deleted_at IS NULL AND t.payload->>'productId' = m.dead;

-- other tables referencing flows / products / categories
UPDATE sync_flow_steps t
SET payload = jsonb_set(t.payload, ARRAY['flowId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_flow_map m WHERE t.deleted_at IS NULL AND t.payload->>'flowId' = m.dead;

UPDATE sync_flow_portion_presets t
SET payload = jsonb_set(t.payload, ARRAY['flowId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_flow_map m WHERE t.deleted_at IS NULL AND t.payload->>'flowId' = m.dead;

UPDATE sync_flow_cleaning_tasks t
SET payload = jsonb_set(t.payload, ARRAY['flowId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_flow_map m WHERE t.deleted_at IS NULL AND t.payload->>'flowId' = m.dead;

UPDATE sync_flow_checklist_items t
SET payload = jsonb_set(t.payload, ARRAY['flowId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_flow_map m WHERE t.deleted_at IS NULL AND t.payload->>'flowId' = m.dead;

UPDATE sync_product_flow_links t
SET payload = jsonb_set(t.payload, ARRAY['flowId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_flow_map m WHERE t.deleted_at IS NULL AND t.payload->>'flowId' = m.dead;

UPDATE sync_product_flow_links t
SET payload = jsonb_set(t.payload, ARRAY['productId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_prod_map m WHERE t.deleted_at IS NULL AND t.payload->>'productId' = m.dead;

UPDATE sync_product_preparations t
SET payload = jsonb_set(t.payload, ARRAY['productId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_prod_map m WHERE t.deleted_at IS NULL AND t.payload->>'productId' = m.dead;

UPDATE sync_baking_profile_products t
SET payload = jsonb_set(t.payload, ARRAY['productId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_prod_map m WHERE t.deleted_at IS NULL AND t.payload->>'productId' = m.dead;

UPDATE sync_weekly_production_plan_items t
SET payload = jsonb_set(t.payload, ARRAY['productId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_prod_map m WHERE t.deleted_at IS NULL AND t.payload->>'productId' = m.dead;

UPDATE sync_process_logs t
SET payload = jsonb_set(t.payload, ARRAY['categoryId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_cat_map m WHERE t.deleted_at IS NULL AND t.payload->>'categoryId' = m.dead;

UPDATE sync_activity_presets t
SET payload = jsonb_set(t.payload, ARRAY['categoryId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_cat_map m WHERE t.deleted_at IS NULL AND t.payload->>'categoryId' = m.dead;

UPDATE sync_targets t
SET payload = jsonb_set(t.payload, ARRAY['categoryId'], to_jsonb(m.live), true), updated_at = now()
FROM tmp_cat_map m WHERE t.deleted_at IS NULL AND t.payload->>'categoryId' = m.dead;

-- ============ 7) DEDUPE children after remap (keep earliest) ============
-- step states by (runId, stepIndex)
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY payload->>'runId', coalesce(payload->>'stepIndex','')
    ORDER BY updated_at ASC, id ASC) AS rn
  FROM sync_run_step_states WHERE deleted_at IS NULL
)
UPDATE sync_run_step_states t
SET deleted_at = now(), updated_at = now()
FROM ranked r WHERE t.id = r.id AND r.rn > 1;
GET DIAGNOSTICS n = ROW_COUNT;
RAISE NOTICE 'step states soft-deleted: %', n;

-- production entries by (date, productId, runId, stepIndex, quantity)
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY payload->>'date', coalesce(payload->>'productId',''),
                 coalesce(payload->>'runId',''), coalesce(payload->>'stepIndex',''),
                 coalesce(payload->>'quantity','')
    ORDER BY updated_at ASC, id ASC) AS rn
  FROM sync_production_entries WHERE deleted_at IS NULL
)
UPDATE sync_production_entries t
SET deleted_at = now(), updated_at = now()
FROM ranked r WHERE t.id = r.id AND r.rn > 1;
GET DIAGNOSTICS n = ROW_COUNT;
RAISE NOTICE 'entries soft-deleted: %', n;

-- flow steps by (flowId, sortOrder, name)
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY payload->>'flowId', coalesce(payload->>'sortOrder',''), lower(coalesce(payload->>'name',''))
    ORDER BY updated_at ASC, id ASC) AS rn
  FROM sync_flow_steps WHERE deleted_at IS NULL AND coalesce(payload->>'name','') <> ''
)
UPDATE sync_flow_steps t
SET deleted_at = now(), updated_at = now()
FROM ranked r WHERE t.id = r.id AND r.rn > 1;
GET DIAGNOSTICS n = ROW_COUNT;
RAISE NOTICE 'flow steps soft-deleted: %', n;

-- product-flow links by (productId, flowId)
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY coalesce(payload->>'productId',''), coalesce(payload->>'flowId','')
    ORDER BY updated_at ASC, id ASC) AS rn
  FROM sync_product_flow_links WHERE deleted_at IS NULL
)
UPDATE sync_product_flow_links t
SET deleted_at = now(), updated_at = now()
FROM ranked r WHERE t.id = r.id AND r.rn > 1;

-- run prep/cleaning checks: exact-duplicate payloads only (conservative)
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY payload->>'runId', md5(payload::text)
    ORDER BY updated_at ASC, id ASC) AS rn
  FROM sync_run_preparation_checks WHERE deleted_at IS NULL
)
UPDATE sync_run_preparation_checks t
SET deleted_at = now(), updated_at = now()
FROM ranked r WHERE t.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY payload->>'runId', md5(payload::text)
    ORDER BY updated_at ASC, id ASC) AS rn
  FROM sync_run_cleaning_checks WHERE deleted_at IS NULL
)
UPDATE sync_run_cleaning_checks t
SET deleted_at = now(), updated_at = now()
FROM ranked r WHERE t.id = r.id AND r.rn > 1;

END $$;
