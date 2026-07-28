-- Sticky "today" dates on older production runs leaked entries into later months.
-- 1) Realign entry.date to live run.date when the calendar month differs
-- 2) Soft-delete orphan-run entries that duplicate a live-run entry (same product+qty)
-- 3) Collapse exact date+product+qty twins created by the realign

-- 1) Realign cross-month entry dates to their run --------------------------------
update sync_production_entries e
set payload = jsonb_set(e.payload, '{date}', to_jsonb(r.payload->>'date'), true),
    updated_at = now()
from sync_production_runs r
where e.deleted_at is null
  and r.deleted_at is null
  and r.id::text = e.payload->>'runId'
  and nullif(e.payload->>'runId', '') is not null
  and coalesce(e.payload->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
  and coalesce(r.payload->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
  and left(e.payload->>'date', 7) <> left(r.payload->>'date', 7);

-- 2) Orphan runId entries that duplicate a live-run-linked row --------------------
with orphans as (
  select e.id, e.payload->>'productId' as pid, e.payload->>'quantity' as qty
  from sync_production_entries e
  left join sync_production_runs r
    on r.id::text = e.payload->>'runId' and r.deleted_at is null
  where e.deleted_at is null
    and nullif(e.payload->>'runId', '') is not null
    and r.id is null
),
dupes as (
  select o.id
  from orphans o
  where exists (
    select 1
    from sync_production_entries e
    join sync_production_runs r
      on r.id::text = e.payload->>'runId' and r.deleted_at is null
    where e.deleted_at is null
      and e.id <> o.id
      and e.payload->>'productId' = o.pid
      and e.payload->>'quantity' = o.qty
  )
)
update sync_production_entries e
set deleted_at = now(), updated_at = now()
where e.id in (select id from dupes);

-- 3) Exact twins after realign ----------------------------------------------------
with ranked as (
  select e.id,
    row_number() over (
      partition by
        e.payload->>'date',
        e.payload->>'productId',
        coalesce(e.payload->>'quantity', '')
      order by
        case
          when nullif(e.payload->>'runId', '') is not null
            and exists (
              select 1 from sync_production_runs r
              where r.deleted_at is null
                and r.id::text = e.payload->>'runId'
            )
          then 0
          when nullif(e.payload->>'runId', '') is not null then 1
          else 2
        end,
        e.updated_at asc,
        e.id asc
    ) as rn
  from sync_production_entries e
  where e.deleted_at is null
    and e.payload ? 'date'
    and e.payload ? 'productId'
)
update sync_production_entries
set deleted_at = now(), updated_at = now()
where id in (select id from ranked where rn > 1);
