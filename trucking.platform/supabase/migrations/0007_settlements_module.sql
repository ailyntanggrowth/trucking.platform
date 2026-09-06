-- Módulo 5 (Contabilidad y Pagos) — esquema inicial.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.
-- No se ejecuta automáticamente: la conexión MCP de este proyecto está en modo solo lectura.
--
-- A diferencia de Cargas/Flota/Combustible, este módulo NO guarda el bruto ni el
-- combustible de cada chofer: esos números siempre se calculan en vivo a partir de
-- loads/fuel_transactions/expenses (lib/settlements.ts), para que una corrección
-- posterior (p.ej. Summar cambia el monto real de una carga) se refleje sola, sin
-- dejar una liquidación vieja con el número equivocado. Lo único que este módulo
-- persiste es: la configuración de la compañía (porcentajes/tramos), el seguro
-- semanal por chofer, y si una liquidación semanal ya se marcó como pagada.

create table if not exists settlements_meta (
  company_id uuid primary key references companies(id) on delete cascade,
  revision integer not null default 0
);

create table if not exists settlements_config (
  company_id uuid primary key references companies(id) on delete cascade,
  company_deduction_pct numeric not null default 0.06,
  dispatcher_commission_pct numeric not null default 0.04,
  tier1_max numeric not null default 8000,
  tier1_pay numeric not null default 2200,
  tier2_max numeric not null default 10000,
  tier2_pay numeric not null default 2500,
  tier3_pay numeric not null default 3000,
  owner_operator_cut_pct numeric not null default 0.12
);

-- Seguro semanal configurable por chofer (spec 7.4/9.5) — 0 si no aplica.
create table if not exists driver_settlement_settings (
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  weekly_insurance numeric not null default 0,
  primary key (company_id, driver_id)
);

-- Una marca por chofer/semana. week_start siempre es un lunes (ver lib/settlements.ts).
create table if not exists settlement_marks (
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  week_start date not null,
  payment_status text not null default 'Pendiente' check (payment_status in ('Pendiente','Pagada')),
  paid_at timestamptz,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (company_id, driver_id, week_start)
);

create table if not exists settlement_events (
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
create index if not exists settlement_events_company_id_idx on settlement_events (company_id);

alter table settlements_meta enable row level security;
alter table settlements_config enable row level security;
alter table driver_settlement_settings enable row level security;
alter table settlement_marks enable row level security;
alter table settlement_events enable row level security;

insert into settlements_meta (company_id, revision) values
  ('00000000-0000-0000-0000-000000000001', 0)
on conflict (company_id) do nothing;

insert into settlements_config (company_id) values
  ('00000000-0000-0000-0000-000000000001')
on conflict (company_id) do nothing;

-- ============================================================================
-- Funciones de escritura. Mismo patrón que loads/fleet/fuel: control de
-- concurrencia optimista + escritura puntual + evento de auditoría, todo en una
-- transacción. La validación de negocio vive en lib/settlements.ts.
-- ============================================================================

create or replace function settlements_bump_revision(p_company_id uuid, p_expected_revision integer)
returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  update settlements_meta set revision = revision + 1
    where company_id = p_company_id and revision = p_expected_revision
    returning revision into v_new_revision;
  if v_new_revision is null then
    raise exception 'REVISION_CONFLICT';
  end if;
  return v_new_revision;
end $$;

create or replace function settlements_insert_event(p_company_id uuid, p_event jsonb)
returns void language plpgsql as $$
begin
  insert into settlement_events (id, company_id, at, actor, entity_ids, detail, before, after)
  values (
    p_event->>'id', p_company_id, (p_event->>'at')::timestamptz, p_event->>'actor',
    coalesce((select array_agg(x) from jsonb_array_elements_text(p_event->'entity_ids') x), '{}'),
    p_event->>'detail', p_event->'before', p_event->'after'
  );
end $$;

create or replace function settlements_commit_config(
  p_company_id uuid, p_expected_revision integer, p_config jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := settlements_bump_revision(p_company_id, p_expected_revision);
  update settlements_config set
    company_deduction_pct = (p_config->>'company_deduction_pct')::numeric,
    dispatcher_commission_pct = (p_config->>'dispatcher_commission_pct')::numeric,
    tier1_max = (p_config->>'tier1_max')::numeric, tier1_pay = (p_config->>'tier1_pay')::numeric,
    tier2_max = (p_config->>'tier2_max')::numeric, tier2_pay = (p_config->>'tier2_pay')::numeric,
    tier3_pay = (p_config->>'tier3_pay')::numeric,
    owner_operator_cut_pct = (p_config->>'owner_operator_cut_pct')::numeric
    where company_id = p_company_id;
  perform settlements_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function settlements_commit_insurance(
  p_company_id uuid, p_expected_revision integer, p_driver_id uuid, p_amount numeric, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := settlements_bump_revision(p_company_id, p_expected_revision);
  insert into driver_settlement_settings (company_id, driver_id, weekly_insurance)
  values (p_company_id, p_driver_id, p_amount)
  on conflict (company_id, driver_id) do update set weekly_insurance = excluded.weekly_insurance;
  perform settlements_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function settlements_commit_mark(
  p_company_id uuid, p_expected_revision integer, p_driver_id uuid, p_week_start date,
  p_payment_status text, p_paid_at timestamptz, p_notes text, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := settlements_bump_revision(p_company_id, p_expected_revision);
  insert into settlement_marks (company_id, driver_id, week_start, payment_status, paid_at, notes, updated_at)
  values (p_company_id, p_driver_id, p_week_start, p_payment_status, p_paid_at, p_notes, now())
  on conflict (company_id, driver_id, week_start) do update set
    payment_status = excluded.payment_status, paid_at = excluded.paid_at, notes = excluded.notes, updated_at = now();
  perform settlements_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

revoke execute on function settlements_bump_revision(uuid, integer) from public;
revoke execute on function settlements_insert_event(uuid, jsonb) from public;
revoke execute on function settlements_commit_config(uuid, integer, jsonb, jsonb) from public;
revoke execute on function settlements_commit_insurance(uuid, integer, uuid, numeric, jsonb) from public;
revoke execute on function settlements_commit_mark(uuid, integer, uuid, date, text, timestamptz, text, jsonb) from public;

grant execute on function settlements_bump_revision(uuid, integer) to service_role;
grant execute on function settlements_insert_event(uuid, jsonb) to service_role;
grant execute on function settlements_commit_config(uuid, integer, jsonb, jsonb) to service_role;
grant execute on function settlements_commit_insurance(uuid, integer, uuid, numeric, jsonb) to service_role;
grant execute on function settlements_commit_mark(uuid, integer, uuid, date, text, timestamptz, text, jsonb) to service_role;
