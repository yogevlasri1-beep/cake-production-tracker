-- Fix monthly production inflation / ghost products:
-- 1) Soft-delete production entries pointing at missing or soft-deleted products
-- 2) Collapse remaining live duplicate products by name (remap FKs, soft-delete extras)
-- 3) Soft-delete exact date+product+quantity twins left after remaps

-- 1) Orphan production entries -------------------------------------------------
update sync_production_entries e
set deleted_at = now(), updated_at = now()
where e.deleted_at is null
  and (
    not exists (
      select 1 from sync_products p
      where p.id::text = e.payload->>'productId'
    )
    or exists (
      select 1 from sync_products p
      where p.id::text = e.payload->>'productId'
        and p.deleted_at is not null
    )
  );

-- 2) Duplicate live products by name ------------------------------------------
do $$
declare
  r record;
begin
  for r in
    with ranked as (
      select id,
        row_number() over (
          partition by lower(trim(coalesce(payload->>'name','')))
          order by updated_at asc, id asc
        ) as rn,
        first_value(id) over (
          partition by lower(trim(coalesce(payload->>'name','')))
          order by updated_at asc, id asc
        ) as keep_id
      from sync_products
      where deleted_at is null
        and coalesce(payload->>'name','') <> ''
    )
    select id as drop_id, keep_id
    from ranked
    where rn > 1
  loop
    if r.keep_id is null or r.keep_id = r.drop_id then
      continue;
    end if;
    perform public.sync_remap_payload_fk('sync_production_entries', 'productId', r.drop_id, r.keep_id);
    perform public.sync_remap_payload_fk('sync_recipe_product_links', 'productId', r.drop_id, r.keep_id);
    perform public.sync_remap_payload_fk('sync_product_recipe_components', 'productId', r.drop_id, r.keep_id);
    perform public.sync_remap_payload_fk('sync_product_portion_components', 'productId', r.drop_id, r.keep_id);
    perform public.sync_remap_payload_fk('sync_product_flow_links', 'productId', r.drop_id, r.keep_id);
    perform public.sync_remap_payload_fk('sync_production_runs', 'productId', r.drop_id, r.keep_id);
    perform public.sync_remap_payload_fk('sync_baking_profile_products', 'productId', r.drop_id, r.keep_id);
    perform public.sync_remap_payload_fk('sync_production_machine_products', 'productId', r.drop_id, r.keep_id);
    perform public.sync_remap_payload_fk('sync_product_preparations', 'productId', r.drop_id, r.keep_id);
    update sync_products
    set deleted_at = now(), updated_at = now()
    where id = r.drop_id and deleted_at is null;
  end loop;
end $$;

-- 3) Exact twins after product remap ------------------------------------------
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
