-- Módulo 2 — reporte de rotura de camión por carga (pedido explícito): qué se
-- rompió y cuánto costó la reparación, para cuando una carga se atrasa por
-- una avería. Un solo reporte "vigente" por carga (se sobreescribe si se
-- vuelve a reportar, se limpia mandando la nota vacía) — no un historial.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.

alter table loads add column if not exists incident_note text not null default '';
alter table loads add column if not exists incident_cost numeric not null default 0;
alter table loads add column if not exists incident_reported_at timestamptz;

create or replace function loads_commit_incident(
  p_company_id uuid, p_expected_revision integer, p_id uuid, p_note text, p_cost numeric, p_reported_at timestamptz, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := loads_bump_revision(p_company_id, p_expected_revision);
  update loads set incident_note = p_note, incident_cost = p_cost, incident_reported_at = p_reported_at, updated_at = now()
    where id = p_id and company_id = p_company_id;
  perform loads_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

revoke execute on function loads_commit_incident(uuid, integer, uuid, text, numeric, timestamptz, jsonb) from public;
grant execute on function loads_commit_incident(uuid, integer, uuid, text, numeric, timestamptz, jsonb) to service_role;
