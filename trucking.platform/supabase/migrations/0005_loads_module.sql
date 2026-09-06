-- Módulo 2 (Cargas y Operaciones) — esquema inicial.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.
-- No se ejecuta automáticamente: la conexión MCP de este proyecto está en modo solo lectura.

create table if not exists loads_meta (
  company_id uuid primary key references companies(id) on delete cascade,
  revision integer not null default 0
);

create table if not exists loads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  load_number text not null default '',
  broker text not null default '',
  driver_id uuid references drivers(id) on delete set null,
  truck_id uuid references equipment(id) on delete set null,
  trailer_id uuid references equipment(id) on delete set null,
  pickup_city text not null default '',
  pickup_state text not null default '',
  pickup_date date not null,
  delivery_city text not null default '',
  delivery_state text not null default '',
  delivery_date date,
  amount numeric not null default 0,
  status text not null default 'Programado' check (status in (
    'Programado','Cargando','En tránsito','Entregada','Pendiente de documentos','Completada','Cancelada','Reemplazada'
  )),
  missing_pod boolean not null default false,
  payment_status text not null default 'Pendiente' check (payment_status in (
    'Pendiente','Facturada','Pagada','Parcial','Disputada','No pagable'
  )),
  amount_received numeric not null default 0,
  notes text not null default '',
  -- Controlados SOLO por sus propias funciones (approve/reject/cancel/replace).
  approval text not null default 'Pendiente' check (approval in ('Pendiente','Aprobada','Rechazada')),
  approved_by text not null default '',
  approved_at timestamptz,
  rejected_reason text not null default '',
  cancel_reason text not null default '',
  cancelled_at timestamptz,
  cancelled_by text not null default '',
  replaces_id uuid references loads(id) on delete set null,
  replaced_by uuid references loads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loads_company_id_idx on loads (company_id);

create table if not exists load_events (
  id text primary key,
  seq bigint generated always as identity,
  company_id uuid not null references companies(id) on delete cascade,
  at timestamptz not null,
  actor text not null,
  entity_ids text[] not null default '{}',
  detail text not null,
  before jsonb,
  after jsonb
);
create index if not exists load_events_company_id_idx on load_events (company_id);

alter table loads_meta enable row level security;
alter table loads enable row level security;
alter table load_events enable row level security;

insert into loads_meta (company_id, revision) values
  ('00000000-0000-0000-0000-000000000001', 0)
on conflict (company_id) do nothing;

-- ============================================================================
-- Funciones de escritura. Mismo esquema que fleet/fuel: cada una hace, en UNA
-- transacción real, (1) el control de concurrencia optimista, (2) la escritura
-- puntual, (3) el insert del evento de auditoría. La VALIDACIÓN de negocio se
-- queda 100% en applyLoadAction (lib/loads.ts); estas funciones son mecánica
-- de persistencia pura — NUNCA deciden si una carga puede aprobarse.
-- ============================================================================

create or replace function loads_bump_revision(p_company_id uuid, p_expected_revision integer)
returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  update loads_meta set revision = revision + 1
    where company_id = p_company_id and revision = p_expected_revision
    returning revision into v_new_revision;
  if v_new_revision is null then
    raise exception 'REVISION_CONFLICT';
  end if;
  return v_new_revision;
end $$;

create or replace function loads_insert_event(p_company_id uuid, p_event jsonb)
returns void language plpgsql as $$
begin
  insert into load_events (id, company_id, at, actor, entity_ids, detail, before, after)
  values (
    p_event->>'id', p_company_id, (p_event->>'at')::timestamptz, p_event->>'actor',
    coalesce((select array_agg(x) from jsonb_array_elements_text(p_event->'entity_ids') x), '{}'),
    p_event->>'detail', p_event->'before', p_event->'after'
  );
end $$;

create or replace function loads_commit_load(
  p_company_id uuid, p_expected_revision integer, p_load jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := loads_bump_revision(p_company_id, p_expected_revision);
  insert into loads (
    id, company_id, load_number, broker, driver_id, truck_id, trailer_id,
    pickup_city, pickup_state, pickup_date, delivery_city, delivery_state, delivery_date,
    amount, status, missing_pod, payment_status, amount_received, notes, updated_at
  ) values (
    (p_load->>'id')::uuid, p_company_id, p_load->>'load_number', p_load->>'broker',
    nullif(p_load->>'driver_id','')::uuid, nullif(p_load->>'truck_id','')::uuid, nullif(p_load->>'trailer_id','')::uuid,
    p_load->>'pickup_city', p_load->>'pickup_state', (p_load->>'pickup_date')::date,
    p_load->>'delivery_city', p_load->>'delivery_state', nullif(p_load->>'delivery_date','')::date,
    (p_load->>'amount')::numeric, p_load->>'status', (p_load->>'missing_pod')::boolean,
    p_load->>'payment_status', (p_load->>'amount_received')::numeric, p_load->>'notes', now()
  )
  on conflict (id) do update set
    load_number = excluded.load_number, broker = excluded.broker, driver_id = excluded.driver_id,
    truck_id = excluded.truck_id, trailer_id = excluded.trailer_id, pickup_city = excluded.pickup_city,
    pickup_state = excluded.pickup_state, pickup_date = excluded.pickup_date, delivery_city = excluded.delivery_city,
    delivery_state = excluded.delivery_state, delivery_date = excluded.delivery_date, amount = excluded.amount,
    status = excluded.status, missing_pod = excluded.missing_pod, payment_status = excluded.payment_status,
    amount_received = excluded.amount_received, notes = excluded.notes, updated_at = now();
  perform loads_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function loads_commit_approve(
  p_company_id uuid, p_expected_revision integer, p_id uuid, p_approved_by text, p_approved_at timestamptz, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := loads_bump_revision(p_company_id, p_expected_revision);
  update loads set approval = 'Aprobada', approved_by = p_approved_by, approved_at = p_approved_at, rejected_reason = '', updated_at = now()
    where id = p_id and company_id = p_company_id;
  perform loads_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function loads_commit_reject(
  p_company_id uuid, p_expected_revision integer, p_id uuid, p_reason text, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := loads_bump_revision(p_company_id, p_expected_revision);
  update loads set approval = 'Rechazada', rejected_reason = p_reason, approved_by = '', approved_at = null, updated_at = now()
    where id = p_id and company_id = p_company_id;
  perform loads_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function loads_commit_cancel(
  p_company_id uuid, p_expected_revision integer, p_id uuid, p_reason text, p_cancelled_by text, p_cancelled_at timestamptz, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := loads_bump_revision(p_company_id, p_expected_revision);
  update loads set status = 'Cancelada', cancel_reason = p_reason, cancelled_by = p_cancelled_by, cancelled_at = p_cancelled_at, updated_at = now()
    where id = p_id and company_id = p_company_id;
  perform loads_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

-- Reemplazo: en UNA transacción, marca la original como Reemplazada (nunca se
-- borra) y crea la carga nueva ya enlazada — nunca se sobrescribe la historia.
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
    amount, status, missing_pod, payment_status, amount_received, notes, replaces_id, updated_at
  ) values (
    (p_replacement->>'id')::uuid, p_company_id, p_replacement->>'load_number', p_replacement->>'broker',
    nullif(p_replacement->>'driver_id','')::uuid, nullif(p_replacement->>'truck_id','')::uuid, nullif(p_replacement->>'trailer_id','')::uuid,
    p_replacement->>'pickup_city', p_replacement->>'pickup_state', (p_replacement->>'pickup_date')::date,
    p_replacement->>'delivery_city', p_replacement->>'delivery_state', nullif(p_replacement->>'delivery_date','')::date,
    (p_replacement->>'amount')::numeric, p_replacement->>'status', (p_replacement->>'missing_pod')::boolean,
    p_replacement->>'payment_status', (p_replacement->>'amount_received')::numeric, p_replacement->>'notes',
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

revoke execute on function loads_bump_revision(uuid, integer) from public;
revoke execute on function loads_insert_event(uuid, jsonb) from public;
revoke execute on function loads_commit_load(uuid, integer, jsonb, jsonb) from public;
revoke execute on function loads_commit_approve(uuid, integer, uuid, text, timestamptz, jsonb) from public;
revoke execute on function loads_commit_reject(uuid, integer, uuid, text, jsonb) from public;
revoke execute on function loads_commit_cancel(uuid, integer, uuid, text, text, timestamptz, jsonb) from public;
revoke execute on function loads_commit_replace(uuid, integer, uuid, text, text, timestamptz, jsonb, jsonb) from public;

grant execute on function loads_bump_revision(uuid, integer) to service_role;
grant execute on function loads_insert_event(uuid, jsonb) to service_role;
grant execute on function loads_commit_load(uuid, integer, jsonb, jsonb) to service_role;
grant execute on function loads_commit_approve(uuid, integer, uuid, text, timestamptz, jsonb) to service_role;
grant execute on function loads_commit_reject(uuid, integer, uuid, text, jsonb) to service_role;
grant execute on function loads_commit_cancel(uuid, integer, uuid, text, text, timestamptz, jsonb) to service_role;
grant execute on function loads_commit_replace(uuid, integer, uuid, text, text, timestamptz, jsonb, jsonb) to service_role;
