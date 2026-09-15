-- "Salarios pagados a mano" (pedido explícito): también acepta pagos a
-- alguien que NO es un chofer registrado (p.ej. la dueña misma, que también
-- cobra un salario) — driver_id ya era opcional, ahora se agrega un nombre
-- libre para cuando no hay chofer que elegir.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.

alter table manual_salary_entries add column if not exists payee_name text not null default '';

create or replace function settlements_commit_manual_salary(
  p_company_id uuid, p_expected_revision integer, p_entry jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := settlements_bump_revision(p_company_id, p_expected_revision);
  insert into manual_salary_entries (id, company_id, week_start, driver_id, payee_name, amount, notes, updated_at)
  values (
    (p_entry->>'id')::uuid, p_company_id, (p_entry->>'week_start')::date,
    nullif(p_entry->>'driver_id','')::uuid, coalesce(p_entry->>'payee_name',''), (p_entry->>'amount')::numeric, p_entry->>'notes', now()
  )
  on conflict (id) do update set
    week_start = excluded.week_start, driver_id = excluded.driver_id, payee_name = excluded.payee_name,
    amount = excluded.amount, notes = excluded.notes, updated_at = now();
  perform settlements_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

revoke execute on function settlements_commit_manual_salary(uuid, integer, jsonb, jsonb) from public;
grant execute on function settlements_commit_manual_salary(uuid, integer, jsonb, jsonb) to service_role;
