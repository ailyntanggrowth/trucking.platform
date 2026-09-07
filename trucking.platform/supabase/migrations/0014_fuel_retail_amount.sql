-- Módulo 4 — guarda el precio de lista (antes del ahorro de Mudflap) de cada
-- transacción de Fuel, para poder sacar el "Total sin descuento" del resumen
-- semanal por grupo que le manda la dueña a Mario los lunes. El propio parser
-- de lib/mudflap.ts ya lee este dato del PDF (retailPrice); antes se
-- descartaba al guardar. Aplicar manualmente en el SQL Editor de Supabase,
-- igual que las anteriores.

alter table fuel_transactions add column if not exists retail_amount numeric not null default 0;

create or replace function fuel_commit_transaction(
  p_company_id uuid, p_expected_revision integer, p_transaction jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fuel_bump_revision(p_company_id, p_expected_revision);
  insert into fuel_transactions (
    id, company_id, date, driver_id, truck_id, load_ref, station, city, state,
    gallons, price_per_gallon, fuel_amount, non_fuel_amount, retail_amount, status, external_ref, notes, updated_at
  ) values (
    (p_transaction->>'id')::uuid, p_company_id, (p_transaction->>'date')::date,
    nullif(p_transaction->>'driver_id','')::uuid, nullif(p_transaction->>'truck_id','')::uuid,
    p_transaction->>'load_ref', p_transaction->>'station', p_transaction->>'city', p_transaction->>'state',
    (p_transaction->>'gallons')::numeric, (p_transaction->>'price_per_gallon')::numeric,
    (p_transaction->>'fuel_amount')::numeric, (p_transaction->>'non_fuel_amount')::numeric,
    coalesce((p_transaction->>'retail_amount')::numeric, 0),
    p_transaction->>'status', p_transaction->>'external_ref', p_transaction->>'notes', now()
  )
  on conflict (id) do update set
    date = excluded.date, driver_id = excluded.driver_id, truck_id = excluded.truck_id, load_ref = excluded.load_ref,
    station = excluded.station, city = excluded.city, state = excluded.state, gallons = excluded.gallons,
    price_per_gallon = excluded.price_per_gallon, fuel_amount = excluded.fuel_amount, non_fuel_amount = excluded.non_fuel_amount,
    retail_amount = excluded.retail_amount,
    status = excluded.status, external_ref = excluded.external_ref, notes = excluded.notes, updated_at = now();
  perform fuel_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function fuel_commit_import(
  p_company_id uuid, p_expected_revision integer, p_transactions jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare
  v_new_revision integer;
  v_item jsonb;
begin
  v_new_revision := fuel_bump_revision(p_company_id, p_expected_revision);
  for v_item in select * from jsonb_array_elements(p_transactions) loop
    insert into fuel_transactions (
      id, company_id, date, driver_id, truck_id, load_ref, station, city, state,
      gallons, price_per_gallon, fuel_amount, non_fuel_amount, retail_amount, status, external_ref, notes, updated_at
    ) values (
      (v_item->>'id')::uuid, p_company_id, (v_item->>'date')::date,
      nullif(v_item->>'driver_id','')::uuid, nullif(v_item->>'truck_id','')::uuid,
      v_item->>'load_ref', v_item->>'station', v_item->>'city', v_item->>'state',
      (v_item->>'gallons')::numeric, (v_item->>'price_per_gallon')::numeric,
      (v_item->>'fuel_amount')::numeric, (v_item->>'non_fuel_amount')::numeric,
      coalesce((v_item->>'retail_amount')::numeric, 0),
      v_item->>'status', v_item->>'external_ref', v_item->>'notes', now()
    );
  end loop;
  perform fuel_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

revoke execute on function fuel_commit_transaction(uuid, integer, jsonb, jsonb) from public;
revoke execute on function fuel_commit_import(uuid, integer, jsonb, jsonb) from public;
grant execute on function fuel_commit_transaction(uuid, integer, jsonb, jsonb) to service_role;
grant execute on function fuel_commit_import(uuid, integer, jsonb, jsonb) to service_role;
