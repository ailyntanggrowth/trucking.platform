-- "Roturas" en Resumen Semanal (pedido explícito): cuando se reporta una
-- rotura de camión en Cargas, el costo (incidentCost) es solo una nota
-- informativa en la carga — nunca se resta de nada, y se pierde apenas se
-- quita el reporte al resolverse (caso real: carga de Agner, rotura de
-- $891.83, reportada y luego quitada sin que quedara reflejada en ningún
-- número). Esta es una lista libre por semana (mismo patrón que
-- manual_salary_entries) para anotar el costo real de una reparación y que sí
-- se reste del "Dinero que queda".
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.

create table if not exists manual_repair_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  week_start date not null,
  driver_id uuid references drivers(id) on delete set null,
  description text not null default '',
  amount numeric not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists manual_repair_entries_company_week_idx on manual_repair_entries (company_id, week_start);
alter table manual_repair_entries enable row level security;

create or replace function settlements_commit_manual_repair(
  p_company_id uuid, p_expected_revision integer, p_entry jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := settlements_bump_revision(p_company_id, p_expected_revision);
  insert into manual_repair_entries (id, company_id, week_start, driver_id, description, amount, notes, updated_at)
  values (
    (p_entry->>'id')::uuid, p_company_id, (p_entry->>'week_start')::date,
    nullif(p_entry->>'driver_id','')::uuid, coalesce(p_entry->>'description',''), (p_entry->>'amount')::numeric, p_entry->>'notes', now()
  )
  on conflict (id) do update set
    week_start = excluded.week_start, driver_id = excluded.driver_id, description = excluded.description,
    amount = excluded.amount, notes = excluded.notes, updated_at = now();
  perform settlements_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function settlements_commit_delete_manual_repair(
  p_company_id uuid, p_expected_revision integer, p_id uuid, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := settlements_bump_revision(p_company_id, p_expected_revision);
  delete from manual_repair_entries where id = p_id and company_id = p_company_id;
  perform settlements_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

revoke execute on function settlements_commit_manual_repair(uuid, integer, jsonb, jsonb) from public;
revoke execute on function settlements_commit_delete_manual_repair(uuid, integer, uuid, jsonb) from public;
grant execute on function settlements_commit_manual_repair(uuid, integer, jsonb, jsonb) to service_role;
grant execute on function settlements_commit_delete_manual_repair(uuid, integer, uuid, jsonb) to service_role;
