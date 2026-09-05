-- Módulo 3 (Choferes, Camiones y Flota) — esquema inicial.
-- Aplicar manualmente en el SQL Editor de Supabase (o `supabase db push`).
-- No se ejecuta automáticamente: la conexión MCP de este proyecto está en modo solo lectura.

create extension if not exists pgcrypto;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Una fila por compañía: contador de revisión (control de concurrencia optimista,
-- reemplaza el chequeo de `revision` que hoy hace lib/use-fleet.ts contra IndexedDB) + warningDays.
create table if not exists fleet_meta (
  company_id uuid primary key references companies(id) on delete cascade,
  revision integer not null default 0,
  warning_days integer not null default 30
);

create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  phone text not null default '',
  email text not null default '',
  group_name text not null default '',
  active boolean not null default true,
  availability text not null default 'Disponible'
    check (availability in ('Disponible','En servicio','Descanso')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists drivers_company_id_idx on drivers (company_id);

-- Camiones y trailers comparten tabla (kind los distingue), igual que lib/fleet.ts
-- ya trata state.trucks / state.trailers como el mismo shape `Equipment`.
create table if not exists equipment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in ('trucks','trailers')),
  unit text not null,
  vin text not null default '',
  plate text not null default '',
  plate_state text not null default '',
  year text not null default '',
  make text not null default '',
  model text not null default '',
  type text not null default '',
  status text not null default 'Disponible'
    check (status in ('Disponible','En mantenimiento','Fuera de servicio','Inactivo')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists equipment_company_id_idx on equipment (company_id);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid not null references drivers(id),
  truck_id uuid not null references equipment(id),
  trailer_id uuid references equipment(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  reason text not null,
  end_reason text
);
create index if not exists assignments_company_id_idx on assignments (company_id);

create table if not exists fleet_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  owner_kind text not null check (owner_kind in ('drivers','trucks','trailers')),
  owner_id uuid not null, -- sin FK: apunta a drivers o equipment según owner_kind,
                          -- igual que hoy entityName() lo resuelve en memoria.
  type text not null,
  issued date,
  expires date,
  reviewed boolean not null default false,
  reviewed_at timestamptz,
  notes text not null default '',
  filename text not null,
  storage_path text not null,
  size_bytes bigint not null,
  uploaded_at timestamptz not null default now()
);
create index if not exists fleet_documents_company_id_idx on fleet_documents (company_id);

create table if not exists fleet_events (
  id text primary key, -- literal "event-<uuid>" tal como lo genera applyFleetAction; NO uuid nativo.
  seq bigint generated always as identity, -- orden real de inserción; `at` puede repetirse al mismo ms.
  company_id uuid not null references companies(id) on delete cascade,
  at timestamptz not null,
  actor text not null,
  entity_ids text[] not null default '{}',
  detail text not null,
  before jsonb,
  after jsonb
);
create index if not exists fleet_events_company_id_idx on fleet_events (company_id);

-- RLS: deny-by-default para anon/authenticated. Solo el service role (BYPASSRLS)
-- puede tocar estas tablas hasta que exista login real (Módulo 8: Usuarios y Permisos).
alter table companies enable row level security;
alter table fleet_meta enable row level security;
alter table drivers enable row level security;
alter table equipment enable row level security;
alter table assignments enable row level security;
alter table fleet_documents enable row level security;
alter table fleet_events enable row level security;

-- Bucket privado para documentos. Verificar en el dashboard (Storage → fleet-documents → Policies)
-- que no queden políticas por defecto, para mantener el mismo deny-by-default que las tablas.
insert into storage.buckets (id, name, public)
values ('fleet-documents','fleet-documents', false)
on conflict (id) do nothing;

-- Compañía única (single-tenant por ahora). UUID fijo para que el código de la app
-- y los scripts de importación lo referencien sin tener que consultarlo.
insert into companies (id, name) values
  ('00000000-0000-0000-0000-000000000001','M&A King Truck Service')
on conflict (id) do nothing;
insert into fleet_meta (company_id, revision, warning_days) values
  ('00000000-0000-0000-0000-000000000001', 0, 30)
on conflict (company_id) do nothing;

-- ============================================================================
-- Funciones de escritura. Cada una hace, en UNA transacción real:
--   1) el control de concurrencia optimista (compara `revision` esperada),
--   2) la escritura puntual de la tabla que corresponde a esa acción,
--   3) el insert del evento de auditoría.
-- La VALIDACIÓN de negocio (nombres/VIN/placa duplicados, "finaliza la asignación
-- antes de...", etc.) se queda 100% en `applyFleetAction` (TypeScript, lib/fleet.ts);
-- estas funciones son mecánica de persistencia pura, nunca deciden si algo es válido.
-- supabase-js/PostgREST no puede mantener una transacción abierta entre llamadas
-- separadas, por eso esta mecánica vive en una función de Postgres invocada vía RPC.
-- ============================================================================

create or replace function fleet_bump_revision(p_company_id uuid, p_expected_revision integer)
returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  update fleet_meta set revision = revision + 1
    where company_id = p_company_id and revision = p_expected_revision
    returning revision into v_new_revision;
  if v_new_revision is null then
    raise exception 'REVISION_CONFLICT';
  end if;
  return v_new_revision;
end $$;

create or replace function fleet_insert_event(p_company_id uuid, p_event jsonb)
returns void language plpgsql as $$
begin
  insert into fleet_events (id, company_id, at, actor, entity_ids, detail, before, after)
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

create or replace function fleet_commit_driver(
  p_company_id uuid, p_expected_revision integer, p_driver jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fleet_bump_revision(p_company_id, p_expected_revision);
  insert into drivers (id, company_id, name, phone, email, group_name, active, availability, notes, updated_at)
  values (
    (p_driver->>'id')::uuid, p_company_id, p_driver->>'name', p_driver->>'phone', p_driver->>'email',
    p_driver->>'group_name', (p_driver->>'active')::boolean, p_driver->>'availability', p_driver->>'notes', now()
  )
  on conflict (id) do update set
    name = excluded.name, phone = excluded.phone, email = excluded.email, group_name = excluded.group_name,
    active = excluded.active, availability = excluded.availability, notes = excluded.notes, updated_at = now();
  perform fleet_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function fleet_commit_equipment(
  p_company_id uuid, p_expected_revision integer, p_equipment jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fleet_bump_revision(p_company_id, p_expected_revision);
  insert into equipment (id, company_id, kind, unit, vin, plate, plate_state, year, make, model, type, status, notes, updated_at)
  values (
    (p_equipment->>'id')::uuid, p_company_id, p_equipment->>'kind', p_equipment->>'unit', p_equipment->>'vin',
    p_equipment->>'plate', p_equipment->>'plate_state', p_equipment->>'year', p_equipment->>'make',
    p_equipment->>'model', p_equipment->>'type', p_equipment->>'status', p_equipment->>'notes', now()
  )
  on conflict (id) do update set
    kind = excluded.kind, unit = excluded.unit, vin = excluded.vin, plate = excluded.plate,
    plate_state = excluded.plate_state, year = excluded.year, make = excluded.make, model = excluded.model,
    type = excluded.type, status = excluded.status, notes = excluded.notes, updated_at = now();
  perform fleet_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function fleet_commit_assign(
  p_company_id uuid, p_expected_revision integer,
  p_old_assignment_id uuid, p_old_ended_at timestamptz, p_old_end_reason text,
  p_new_assignment jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fleet_bump_revision(p_company_id, p_expected_revision);
  if p_old_assignment_id is not null then
    update assignments set ended_at = p_old_ended_at, end_reason = p_old_end_reason
      where id = p_old_assignment_id and company_id = p_company_id;
  end if;
  insert into assignments (id, company_id, driver_id, truck_id, trailer_id, started_at, reason)
  values (
    (p_new_assignment->>'id')::uuid, p_company_id, (p_new_assignment->>'driver_id')::uuid,
    (p_new_assignment->>'truck_id')::uuid, nullif(p_new_assignment->>'trailer_id','')::uuid,
    (p_new_assignment->>'started_at')::timestamptz, p_new_assignment->>'reason'
  );
  perform fleet_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function fleet_commit_end_assignment(
  p_company_id uuid, p_expected_revision integer, p_assignment_id uuid,
  p_ended_at timestamptz, p_end_reason text, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fleet_bump_revision(p_company_id, p_expected_revision);
  update assignments set ended_at = p_ended_at, end_reason = p_end_reason
    where id = p_assignment_id and company_id = p_company_id;
  perform fleet_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function fleet_commit_document(
  p_company_id uuid, p_expected_revision integer, p_document jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fleet_bump_revision(p_company_id, p_expected_revision);
  insert into fleet_documents (id, company_id, owner_kind, owner_id, type, issued, expires, reviewed, notes, filename, storage_path, size_bytes)
  values (
    (p_document->>'id')::uuid, p_company_id, p_document->>'owner_kind', (p_document->>'owner_id')::uuid,
    p_document->>'type', nullif(p_document->>'issued','')::date, nullif(p_document->>'expires','')::date,
    false, p_document->>'notes', p_document->>'filename', p_document->>'storage_path', (p_document->>'size_bytes')::bigint
  );
  perform fleet_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function fleet_commit_review_document(
  p_company_id uuid, p_expected_revision integer, p_document_id uuid,
  p_reviewed boolean, p_reviewed_at timestamptz, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fleet_bump_revision(p_company_id, p_expected_revision);
  update fleet_documents set reviewed = p_reviewed, reviewed_at = p_reviewed_at
    where id = p_document_id and company_id = p_company_id;
  perform fleet_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function fleet_commit_warning_days(
  p_company_id uuid, p_expected_revision integer, p_warning_days integer, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fleet_bump_revision(p_company_id, p_expected_revision);
  update fleet_meta set warning_days = p_warning_days where company_id = p_company_id;
  perform fleet_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

-- IMPORTANTE: por defecto Postgres otorga EXECUTE sobre funciones nuevas a PUBLIC,
-- lo que expondría estas funciones como endpoints RPC llamables con la clave anon
-- vía PostgREST — rompiendo el deny-by-default que ya aplicamos a las tablas.
-- Se revoca de PUBLIC y se otorga solo a service_role (el único rol que estas
-- Server Actions usan).
revoke execute on function fleet_bump_revision(uuid, integer) from public;
revoke execute on function fleet_insert_event(uuid, jsonb) from public;
revoke execute on function fleet_commit_driver(uuid, integer, jsonb, jsonb) from public;
revoke execute on function fleet_commit_equipment(uuid, integer, jsonb, jsonb) from public;
revoke execute on function fleet_commit_assign(uuid, integer, uuid, timestamptz, text, jsonb, jsonb) from public;
revoke execute on function fleet_commit_end_assignment(uuid, integer, uuid, timestamptz, text, jsonb) from public;
revoke execute on function fleet_commit_document(uuid, integer, jsonb, jsonb) from public;
revoke execute on function fleet_commit_review_document(uuid, integer, uuid, boolean, timestamptz, jsonb) from public;
revoke execute on function fleet_commit_warning_days(uuid, integer, integer, jsonb) from public;

grant execute on function fleet_bump_revision(uuid, integer) to service_role;
grant execute on function fleet_insert_event(uuid, jsonb) to service_role;
grant execute on function fleet_commit_driver(uuid, integer, jsonb, jsonb) to service_role;
grant execute on function fleet_commit_equipment(uuid, integer, jsonb, jsonb) to service_role;
grant execute on function fleet_commit_assign(uuid, integer, uuid, timestamptz, text, jsonb, jsonb) to service_role;
grant execute on function fleet_commit_end_assignment(uuid, integer, uuid, timestamptz, text, jsonb) to service_role;
grant execute on function fleet_commit_document(uuid, integer, jsonb, jsonb) to service_role;
grant execute on function fleet_commit_review_document(uuid, integer, uuid, boolean, timestamptz, jsonb) to service_role;
grant execute on function fleet_commit_warning_days(uuid, integer, integer, jsonb) to service_role;
