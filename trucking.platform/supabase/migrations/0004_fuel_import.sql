-- Módulo 4 — importación en lote de statements (Mudflap u otra fuente).
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.
-- Un statement completo se guarda como UNA sola escritura: una revisión, un
-- solo evento de auditoría con el detalle, en vez de N eventos sueltos.

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
      gallons, price_per_gallon, fuel_amount, non_fuel_amount, status, external_ref, notes, updated_at
    ) values (
      (v_item->>'id')::uuid, p_company_id, (v_item->>'date')::date,
      nullif(v_item->>'driver_id','')::uuid, nullif(v_item->>'truck_id','')::uuid,
      v_item->>'load_ref', v_item->>'station', v_item->>'city', v_item->>'state',
      (v_item->>'gallons')::numeric, (v_item->>'price_per_gallon')::numeric,
      (v_item->>'fuel_amount')::numeric, (v_item->>'non_fuel_amount')::numeric,
      v_item->>'status', v_item->>'external_ref', v_item->>'notes', now()
    );
  end loop;
  perform fuel_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

revoke execute on function fuel_commit_import(uuid, integer, jsonb, jsonb) from public;
grant execute on function fuel_commit_import(uuid, integer, jsonb, jsonb) to service_role;
