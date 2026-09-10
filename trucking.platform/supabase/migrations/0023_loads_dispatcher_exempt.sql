-- Agrega dispatcher_exempt: marca una carga puntual como excluida del invoice
-- del despachador (comisión del 4%), sin sacarla de nada más (Bruto, reportes
-- de grupo, etc.). Caso real: Mario le pagó directo a un chofer por una carga
-- que normalmente pasaría por el despachador, sin que Gleybis interviniera,
-- así que esa carga puntual no debe generarle comisión a ella.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.

alter table loads add column if not exists dispatcher_exempt boolean not null default false;

create or replace function loads_commit_load(
  p_company_id uuid, p_expected_revision integer, p_load jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := loads_bump_revision(p_company_id, p_expected_revision);
  insert into loads (
    id, company_id, load_number, broker, driver_id, truck_id, trailer_id,
    pickup_city, pickup_state, pickup_date, delivery_city, delivery_state, delivery_date,
    amount, status, missing_pod, payment_status, amount_received, paid_at, notes,
    approval, approved_by, approved_at, dispatcher_exempt, updated_at
  ) values (
    (p_load->>'id')::uuid, p_company_id, p_load->>'load_number', p_load->>'broker',
    nullif(p_load->>'driver_id','')::uuid, nullif(p_load->>'truck_id','')::uuid, nullif(p_load->>'trailer_id','')::uuid,
    p_load->>'pickup_city', p_load->>'pickup_state', (p_load->>'pickup_date')::date,
    p_load->>'delivery_city', p_load->>'delivery_state', nullif(p_load->>'delivery_date','')::date,
    (p_load->>'amount')::numeric, p_load->>'status', (p_load->>'missing_pod')::boolean,
    p_load->>'payment_status', (p_load->>'amount_received')::numeric, nullif(p_load->>'paid_at','')::timestamptz, p_load->>'notes',
    coalesce(p_load->>'approval', 'Pendiente'), coalesce(p_load->>'approved_by', ''), nullif(p_load->>'approved_at','')::timestamptz,
    coalesce((p_load->>'dispatcher_exempt')::boolean, false),
    now()
  )
  on conflict (id) do update set
    load_number = excluded.load_number, broker = excluded.broker, driver_id = excluded.driver_id,
    truck_id = excluded.truck_id, trailer_id = excluded.trailer_id, pickup_city = excluded.pickup_city,
    pickup_state = excluded.pickup_state, pickup_date = excluded.pickup_date, delivery_city = excluded.delivery_city,
    delivery_state = excluded.delivery_state, delivery_date = excluded.delivery_date, amount = excluded.amount,
    status = excluded.status, missing_pod = excluded.missing_pod, payment_status = excluded.payment_status,
    amount_received = excluded.amount_received, paid_at = excluded.paid_at, notes = excluded.notes,
    dispatcher_exempt = excluded.dispatcher_exempt, updated_at = now();
  perform loads_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function loads_commit_replace(
  p_company_id uuid, p_expected_revision integer, p_original_id uuid, p_reason text,
  p_cancelled_by text, p_cancelled_at timestamptz, p_replacement jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := loads_bump_revision(p_company_id, p_expected_revision);
  insert into loads (
    id, company_id, load_number, broker, driver_id, truck_id, trailer_id,
    pickup_city, pickup_state, pickup_date, delivery_city, delivery_state, delivery_date,
    amount, status, missing_pod, payment_status, amount_received, paid_at, notes,
    approval, approved_by, approved_at, dispatcher_exempt, replaces_id, updated_at
  ) values (
    (p_replacement->>'id')::uuid, p_company_id, p_replacement->>'load_number', p_replacement->>'broker',
    nullif(p_replacement->>'driver_id','')::uuid, nullif(p_replacement->>'truck_id','')::uuid, nullif(p_replacement->>'trailer_id','')::uuid,
    p_replacement->>'pickup_city', p_replacement->>'pickup_state', (p_replacement->>'pickup_date')::date,
    p_replacement->>'delivery_city', p_replacement->>'delivery_state', nullif(p_replacement->>'delivery_date','')::date,
    (p_replacement->>'amount')::numeric, p_replacement->>'status', (p_replacement->>'missing_pod')::boolean,
    p_replacement->>'payment_status', (p_replacement->>'amount_received')::numeric, nullif(p_replacement->>'paid_at','')::timestamptz, p_replacement->>'notes',
    coalesce(p_replacement->>'approval', 'Pendiente'), coalesce(p_replacement->>'approved_by', ''), nullif(p_replacement->>'approved_at','')::timestamptz,
    coalesce((p_replacement->>'dispatcher_exempt')::boolean, false),
    p_original_id, now()
  );
  update loads set status = 'Reemplazada', replaced_by = (p_replacement->>'id')::uuid,
    cancel_reason = coalesce(nullif(cancel_reason,''), p_reason),
    cancelled_by = coalesce(nullif(cancelled_by,''), p_cancelled_by),
    cancelled_at = coalesce(cancelled_at, p_cancelled_at),
    updated_at = now()
    where id = p_original_id and company_id = p_company_id;
  perform loads_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;
