-- Módulo 4 (Combustible y Gastos) — esquema inicial.
-- Aplicar manualmente en el SQL Editor de Supabase (o `supabase db push`).
-- No se ejecuta automáticamente: la conexión MCP de este proyecto está en modo solo lectura.

-- Una fila por compañía: contador de revisión propio de este módulo (control de
-- concurrencia optimista, igual que fleet_meta en 0001, pero independiente:
-- Combustible y Flota son módulos distintos y no deben compartir revisión).
create table if not exists fuel_meta (
  company_id uuid primary key references companies(id) on delete cascade,
  revision integer not null default 0
);

create table if not exists fuel_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  date date not null,
  driver_id uuid references drivers(id) on delete set null,
  truck_id uuid references equipment(id) on delete set null,
  load_ref text not null default '', -- referencia de carga en texto libre: Módulo 2 (Cargas) aún no tiene tablas reales
  station text not null default '',
  city text not null default '',
  state text not null default '',
  gallons numeric not null default 0,
  price_per_gallon numeric not null default 0,
  fuel_amount numeric not null default 0,
  non_fuel_amount numeric not null default 0,
  status text not null default 'Pendiente' check (status in ('Pendiente','Final')),
  external_ref text not null default '', -- p.ej. ID de transacción de Mudflap
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fuel_transactions_company_id_idx on fuel_transactions (company_id);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  category text not null check (category in (
    'Peajes','Reparaciones','Mantenimiento','Estacionamiento','Básculas',
    'Permisos','Lavado de camión','Otro gasto de chofer','Gasto de compañía'
  )),
  amount numeric not null default 0,
  date date not null,
  driver_id uuid references drivers(id) on delete set null,
  truck_id uuid references equipment(id) on delete set null,
  load_ref text not null default '',
  payment_method text not null default '',
  notes text not null default '',
  status text not null default 'Pendiente' check (status in ('Pendiente','Final')),
  receipt_filename text,
  receipt_storage_path text,
  receipt_size_bytes bigint,
  receipt_uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_company_id_idx on expenses (company_id);

create table if not exists fuel_events (
  id text primary key, -- literal "event-<uuid>" tal como lo genera applyFuelAction; NO uuid nativo.
  seq bigint generated always as identity,
  company_id uuid not null references companies(id) on delete cascade,
  at timestamptz not null,
  actor text not null,
  entity_ids text[] not null default '{}',
  detail text not null,
  before jsonb,
  after jsonb
);
create index if not exists fuel_events_company_id_idx on fuel_events (company_id);

-- RLS: deny-by-default para anon/authenticated, igual que el resto del proyecto
-- hasta que exista login real (Módulo 8: Usuarios y Permisos).
alter table fuel_meta enable row level security;
alter table fuel_transactions enable row level security;
alter table expenses enable row level security;
alter table fuel_events enable row level security;

-- Bucket privado para recibos de gastos.
insert into storage.buckets (id, name, public)
values ('fuel-receipts','fuel-receipts', false)
on conflict (id) do nothing;

insert into fuel_meta (company_id, revision) values
  ('00000000-0000-0000-0000-000000000001', 0)
on conflict (company_id) do nothing;

-- ============================================================================
-- Funciones de escritura. Mismo esquema que 0001_fleet_module.sql: cada una hace,
-- en UNA transacción real, (1) el control de concurrencia optimista, (2) la
-- escritura puntual, (3) el insert del evento de auditoría. La VALIDACIÓN de
-- negocio se queda 100% en applyFuelAction (lib/fuel.ts); estas funciones son
-- mecánica de persistencia pura.
-- ============================================================================

create or replace function fuel_bump_revision(p_company_id uuid, p_expected_revision integer)
returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  update fuel_meta set revision = revision + 1
    where company_id = p_company_id and revision = p_expected_revision
    returning revision into v_new_revision;
  if v_new_revision is null then
    raise exception 'REVISION_CONFLICT';
  end if;
  return v_new_revision;
end $$;

create or replace function fuel_insert_event(p_company_id uuid, p_event jsonb)
returns void language plpgsql as $$
begin
  insert into fuel_events (id, company_id, at, actor, entity_ids, detail, before, after)
  values (
    p_event->>'id',
    p_company_id,
    (p_event->>'at')::timestamptz,
    p_event->>'actor',
    coalesce((select array_agg(x) from jsonb_array_elements_text(p_event->'entity_ids') x), '{}'),
    p_event->>'detail',
    p_event->'before',
    p_event->'after'
  );
end $$;

create or replace function fuel_commit_transaction(
  p_company_id uuid, p_expected_revision integer, p_transaction jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fuel_bump_revision(p_company_id, p_expected_revision);
  insert into fuel_transactions (
    id, company_id, date, driver_id, truck_id, load_ref, station, city, state,
    gallons, price_per_gallon, fuel_amount, non_fuel_amount, status, external_ref, notes, updated_at
  ) values (
    (p_transaction->>'id')::uuid, p_company_id, (p_transaction->>'date')::date,
    nullif(p_transaction->>'driver_id','')::uuid, nullif(p_transaction->>'truck_id','')::uuid,
    p_transaction->>'load_ref', p_transaction->>'station', p_transaction->>'city', p_transaction->>'state',
    (p_transaction->>'gallons')::numeric, (p_transaction->>'price_per_gallon')::numeric,
    (p_transaction->>'fuel_amount')::numeric, (p_transaction->>'non_fuel_amount')::numeric,
    p_transaction->>'status', p_transaction->>'external_ref', p_transaction->>'notes', now()
  )
  on conflict (id) do update set
    date = excluded.date, driver_id = excluded.driver_id, truck_id = excluded.truck_id, load_ref = excluded.load_ref,
    station = excluded.station, city = excluded.city, state = excluded.state, gallons = excluded.gallons,
    price_per_gallon = excluded.price_per_gallon, fuel_amount = excluded.fuel_amount, non_fuel_amount = excluded.non_fuel_amount,
    status = excluded.status, external_ref = excluded.external_ref, notes = excluded.notes, updated_at = now();
  perform fuel_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function fuel_commit_expense(
  p_company_id uuid, p_expected_revision integer, p_expense jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fuel_bump_revision(p_company_id, p_expected_revision);
  insert into expenses (
    id, company_id, category, amount, date, driver_id, truck_id, load_ref, payment_method, notes, status,
    receipt_filename, receipt_storage_path, receipt_size_bytes, receipt_uploaded_at, updated_at
  ) values (
    (p_expense->>'id')::uuid, p_company_id, p_expense->>'category', (p_expense->>'amount')::numeric,
    (p_expense->>'date')::date, nullif(p_expense->>'driver_id','')::uuid, nullif(p_expense->>'truck_id','')::uuid,
    p_expense->>'load_ref', p_expense->>'payment_method', p_expense->>'notes', p_expense->>'status',
    p_expense->>'receipt_filename', p_expense->>'receipt_storage_path',
    nullif(p_expense->>'receipt_size_bytes','')::bigint, nullif(p_expense->>'receipt_uploaded_at','')::timestamptz, now()
  )
  -- Al editar sin subir un recibo nuevo, el recibo existente se conserva
  -- (coalesce contra la fila ya guardada) en vez de borrarse.
  on conflict (id) do update set
    category = excluded.category, amount = excluded.amount, date = excluded.date,
    driver_id = excluded.driver_id, truck_id = excluded.truck_id, load_ref = excluded.load_ref,
    payment_method = excluded.payment_method, notes = excluded.notes, status = excluded.status,
    receipt_filename = coalesce(excluded.receipt_filename, expenses.receipt_filename),
    receipt_storage_path = coalesce(excluded.receipt_storage_path, expenses.receipt_storage_path),
    receipt_size_bytes = coalesce(excluded.receipt_size_bytes, expenses.receipt_size_bytes),
    receipt_uploaded_at = coalesce(excluded.receipt_uploaded_at, expenses.receipt_uploaded_at),
    updated_at = now();
  perform fuel_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function fuel_commit_status(
  p_company_id uuid, p_expected_revision integer, p_kind text, p_id uuid, p_status text, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fuel_bump_revision(p_company_id, p_expected_revision);
  if p_kind = 'transaction' then
    update fuel_transactions set status = p_status, updated_at = now() where id = p_id and company_id = p_company_id;
  else
    update expenses set status = p_status, updated_at = now() where id = p_id and company_id = p_company_id;
  end if;
  perform fuel_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function fuel_commit_delete(
  p_company_id uuid, p_expected_revision integer, p_kind text, p_id uuid, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fuel_bump_revision(p_company_id, p_expected_revision);
  if p_kind = 'transaction' then
    delete from fuel_transactions where id = p_id and company_id = p_company_id;
  else
    delete from expenses where id = p_id and company_id = p_company_id;
  end if;
  perform fuel_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

-- IMPORTANTE: por defecto Postgres otorga EXECUTE sobre funciones nuevas a PUBLIC.
-- Se revoca de PUBLIC y se otorga solo a service_role (el único rol que estas
-- Server Actions usan), igual que en 0001_fleet_module.sql.
revoke execute on function fuel_bump_revision(uuid, integer) from public;
revoke execute on function fuel_insert_event(uuid, jsonb) from public;
revoke execute on function fuel_commit_transaction(uuid, integer, jsonb, jsonb) from public;
revoke execute on function fuel_commit_expense(uuid, integer, jsonb, jsonb) from public;
revoke execute on function fuel_commit_status(uuid, integer, text, uuid, text, jsonb) from public;
revoke execute on function fuel_commit_delete(uuid, integer, text, uuid, jsonb) from public;

grant execute on function fuel_bump_revision(uuid, integer) to service_role;
grant execute on function fuel_insert_event(uuid, jsonb) to service_role;
grant execute on function fuel_commit_transaction(uuid, integer, jsonb, jsonb) to service_role;
grant execute on function fuel_commit_expense(uuid, integer, jsonb, jsonb) to service_role;
grant execute on function fuel_commit_status(uuid, integer, text, uuid, text, jsonb) to service_role;
grant execute on function fuel_commit_delete(uuid, integer, text, uuid, jsonb) to service_role;
