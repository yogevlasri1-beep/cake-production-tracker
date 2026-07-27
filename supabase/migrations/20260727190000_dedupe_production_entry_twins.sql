-- Soft-delete duplicate production entries that share date+productId+quantity.
-- Typical pattern after orphan-run cleanup: one row linked to a live run, and a
-- twin with runId null (or a second remapped run). Keep the run-linked / oldest row.

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
