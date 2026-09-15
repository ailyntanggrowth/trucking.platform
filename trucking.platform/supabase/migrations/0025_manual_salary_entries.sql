-- Módulo 5 — "Salarios" (pedido explícito): lista libre de pagos hechos a
-- mano fuera del flujo normal de "Pagos a Choferes", para cuando ella ya le
-- pagó a un chofer un monto que el sistema todavía no puede calcular solo
-- (p.ej. un viaje que sigue abierto desde hace semanas, sin cerrar en
-- Cargas). No es una marca por chofer/semana como settlement_marks — se
-- puede agregar, editar o quitar cualquier cantidad de entradas.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.

create table if not exists manual_salary_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  week_start date not null,
  driver_id uuid references drivers(id) on delete set null,
  amount numeric not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists manual_salary_entries_company_week_idx on manual_salary_entries (company_id, week_start);
alter table manual_salary_entries enable row level security;

create or replace function settlements_commit_manual_salary(
  p_company_id uuid, p_expected_revision integer, p_entry jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := settlements_bump_revision(p_company_id, p_expected_revision);
  insert into manual_salary_entries (id, company_id, week_start, driver_id, amount, notes, updated_at)
  values (
    (p_entry->>'id')::uuid, p_company_id, (p_entry->>'week_start')::date,
    nullif(p_entry->>'driver_id','')::uuid, (p_entry->>'amount')::numeric, p_entry->>'notes', now()
  )
  on conflict (id) do update set
    week_start = excluded.week_start, driver_id = excluded.driver_id,
    amount = excluded.amount, notes = excluded.notes, updated_at = now();
  perform settlements_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function settlements_commit_delete_manual_salary(
  p_company_id uuid, p_expected_revision integer, p_id uuid, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := settlements_bump_revision(p_company_id, p_expected_revision);
  delete from manual_salary_entries where id = p_id and company_id = p_company_id;
  perform settlements_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

revoke execute on function settlements_commit_manual_salary(uuid, integer, jsonb, jsonb) from public;
revoke execute on function settlements_commit_delete_manual_salary(uuid, integer, uuid, jsonb) from public;
grant execute on function settlements_commit_manual_salary(uuid, integer, jsonb, jsonb) to service_role;
grant execute on function settlements_commit_delete_manual_salary(uuid, integer, uuid, jsonb) to service_role;
