-- Módulo 5 — cierre manual de la semana (pedido explícito): ya no es una
-- hora fija automática (un feriado la corre, y una fórmula no aguanta
-- excepciones) — un Administrador cierra la semana a mano, cuando quiera,
-- y esa fecha/hora exacta es la que reparte cargas pagadas entre el invoice
-- que cierra y el siguiente. Aplicar manualmente en el SQL Editor de
-- Supabase, igual que las anteriores.

create table if not exists week_locks (
  company_id uuid not null references companies(id) on delete cascade,
  week_end date not null,
  locked_at timestamptz not null,
  primary key (company_id, week_end)
);
alter table week_locks enable row level security;

create or replace function settlements_commit_close_week(
  p_company_id uuid, p_expected_revision integer, p_week_end date, p_locked_at timestamptz, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := settlements_bump_revision(p_company_id, p_expected_revision);
  insert into week_locks (company_id, week_end, locked_at) values (p_company_id, p_week_end, p_locked_at);
  perform settlements_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function settlements_commit_reopen_week(
  p_company_id uuid, p_expected_revision integer, p_week_end date, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := settlements_bump_revision(p_company_id, p_expected_revision);
  delete from week_locks where company_id = p_company_id and week_end = p_week_end;
  perform settlements_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

revoke execute on function settlements_commit_close_week(uuid, integer, date, timestamptz, jsonb) from public;
revoke execute on function settlements_commit_reopen_week(uuid, integer, date, jsonb) from public;
grant execute on function settlements_commit_close_week(uuid, integer, date, timestamptz, jsonb) to service_role;
grant execute on function settlements_commit_reopen_week(uuid, integer, date, jsonb) to service_role;
