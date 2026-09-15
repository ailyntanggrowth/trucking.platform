-- Módulo 4 (Combustible) — cada transacción queda ligada a la SEMANA DEL
-- STATEMENT (lunes de inicio del período que Mudflap declara en el PDF), no
-- solo a su propia fecha de compra. Pedido explícito: un statement "del 7 al
-- 13" puede traer transacciones fechadas uno o dos días antes (rezago normal
-- de procesamiento de Mudflap) y deben seguir contando en ESA semana, nunca
-- en la anterior — si se agrupara solo por fecha, el resumen semanal no
-- cuadraría con el total oficial impreso en el statement.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.

alter table fuel_transactions add column if not exists statement_week date;

-- Relleno de filas existentes: lunes de la semana de su propia fecha
-- (date_trunc('week', ..) en Postgres ya usa lunes como día 1, igual que
-- fuelWeekStartOf en lib/settlements.ts) — es la mejor aproximación posible
-- para datos ya importados antes de que existiera esta columna.
update fuel_transactions set statement_week = date_trunc('week', date)::date where statement_week is null;

alter table fuel_transactions alter column statement_week set not null;
create index if not exists fuel_transactions_statement_week_idx on fuel_transactions (company_id, statement_week);

create or replace function fuel_commit_transaction(
  p_company_id uuid, p_expected_revision integer, p_transaction jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fuel_bump_revision(p_company_id, p_expected_revision);
  insert into fuel_transactions (
    id, company_id, date, driver_id, truck_id, load_ref, station, city, state,
    gallons, price_per_gallon, fuel_amount, non_fuel_amount, retail_amount, status, external_ref, notes, statement_week, updated_at
  ) values (
    (p_transaction->>'id')::uuid, p_company_id, (p_transaction->>'date')::date,
    nullif(p_transaction->>'driver_id','')::uuid, nullif(p_transaction->>'truck_id','')::uuid,
    p_transaction->>'load_ref', p_transaction->>'station', p_transaction->>'city', p_transaction->>'state',
    (p_transaction->>'gallons')::numeric, (p_transaction->>'price_per_gallon')::numeric,
    (p_transaction->>'fuel_amount')::numeric, (p_transaction->>'non_fuel_amount')::numeric,
    coalesce((p_transaction->>'retail_amount')::numeric, 0),
    p_transaction->>'status', p_transaction->>'external_ref', p_transaction->>'notes',
    coalesce((p_transaction->>'statement_week')::date, date_trunc('week', (p_transaction->>'date')::date)::date),
    now()
  )
  on conflict (id) do update set
    date = excluded.date, driver_id = excluded.driver_id, truck_id = excluded.truck_id, load_ref = excluded.load_ref,
    station = excluded.station, city = excluded.city, state = excluded.state, gallons = excluded.gallons,
    price_per_gallon = excluded.price_per_gallon, fuel_amount = excluded.fuel_amount, non_fuel_amount = excluded.non_fuel_amount,
    retail_amount = excluded.retail_amount,
    status = excluded.status, external_ref = excluded.external_ref, notes = excluded.notes,
    statement_week = excluded.statement_week, updated_at = now();
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
      gallons, price_per_gallon, fuel_amount, non_fuel_amount, retail_amount, status, external_ref, notes, statement_week, updated_at
    ) values (
      (v_item->>'id')::uuid, p_company_id, (v_item->>'date')::date,
      nullif(v_item->>'driver_id','')::uuid, nullif(v_item->>'truck_id','')::uuid,
      v_item->>'load_ref', v_item->>'station', v_item->>'city', v_item->>'state',
      (v_item->>'gallons')::numeric, (v_item->>'price_per_gallon')::numeric,
      (v_item->>'fuel_amount')::numeric, (v_item->>'non_fuel_amount')::numeric,
      coalesce((v_item->>'retail_amount')::numeric, 0),
      v_item->>'status', v_item->>'external_ref', v_item->>'notes',
      coalesce((v_item->>'statement_week')::date, date_trunc('week', (v_item->>'date')::date)::date),
      now()
    );
  end loop;
  perform fuel_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

revoke execute on function fuel_commit_transaction(uuid, integer, jsonb, jsonb) from public;
revoke execute on function fuel_commit_import(uuid, integer, jsonb, jsonb) from public;
grant execute on function fuel_commit_transaction(uuid, integer, jsonb, jsonb) to service_role;
grant execute on function fuel_commit_import(uuid, integer, jsonb, jsonb) to service_role;
