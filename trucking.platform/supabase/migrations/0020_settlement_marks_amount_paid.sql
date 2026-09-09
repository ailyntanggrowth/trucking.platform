-- Módulo 5 — monto REAL pagado al chofer del grupo Mario (pedido explícito):
-- puede ser distinto al salario estimado por tramos (por ejemplo, Mario le
-- paga menos y compensa el resto en efectivo por fuera del sistema), así que
-- la ganancia real de la empresa se calcula con este monto, no con el
-- estimado. Se anota desde el recorrido de chofer en Cargas. Aplicar
-- manualmente en el SQL Editor de Supabase, igual que las anteriores.

alter table settlement_marks add column if not exists amount_paid numeric not null default 0;

create or replace function settlements_commit_mark(
  p_company_id uuid, p_expected_revision integer, p_driver_id uuid, p_week_start date,
  p_payment_status text, p_paid_at timestamptz, p_amount_paid numeric, p_notes text, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := settlements_bump_revision(p_company_id, p_expected_revision);
  insert into settlement_marks (company_id, driver_id, week_start, payment_status, paid_at, amount_paid, notes, updated_at)
  values (p_company_id, p_driver_id, p_week_start, p_payment_status, p_paid_at, p_amount_paid, p_notes, now())
  on conflict (company_id, driver_id, week_start) do update set
    payment_status = excluded.payment_status, paid_at = excluded.paid_at, amount_paid = excluded.amount_paid, notes = excluded.notes, updated_at = now();
  perform settlements_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

revoke execute on function settlements_commit_mark(uuid, integer, uuid, date, text, timestamptz, numeric, text, jsonb) from public;
grant execute on function settlements_commit_mark(uuid, integer, uuid, date, text, timestamptz, numeric, text, jsonb) to service_role;

-- La firma anterior (sin amount_paid) queda huérfana — la borramos para que
-- no queden dos versiones de la misma función.
drop function if exists settlements_commit_mark(uuid, integer, uuid, date, text, timestamptz, text, jsonb);
