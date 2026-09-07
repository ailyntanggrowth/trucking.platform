-- Módulo 5 — marca si ya se le pagó a la despachadora el invoice de una
-- semana. Aparte de settlement_marks (que es por chofer): aquí no hay
-- driver_id porque es un solo pago semanal de comisión, no por chofer. Lo
-- controla un Administrador desde Contabilidad y Pagos — la despachadora solo
-- lo ve, nunca lo marca ella misma (pedido explícito de la dueña). Aplicar
-- manualmente en el SQL Editor de Supabase, igual que las anteriores.

create table if not exists dispatcher_invoice_marks (
  company_id uuid not null references companies(id) on delete cascade,
  week_start date not null,
  payment_status text not null default 'Pendiente' check (payment_status in ('Pendiente','Pagada')),
  paid_at timestamptz,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (company_id, week_start)
);
alter table dispatcher_invoice_marks enable row level security;

create or replace function settlements_commit_dispatcher_mark(
  p_company_id uuid, p_expected_revision integer, p_week_start date,
  p_payment_status text, p_paid_at timestamptz, p_notes text, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := settlements_bump_revision(p_company_id, p_expected_revision);
  insert into dispatcher_invoice_marks (company_id, week_start, payment_status, paid_at, notes, updated_at)
  values (p_company_id, p_week_start, p_payment_status, p_paid_at, p_notes, now())
  on conflict (company_id, week_start) do update set
    payment_status = excluded.payment_status, paid_at = excluded.paid_at, notes = excluded.notes, updated_at = now();
  perform settlements_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

revoke execute on function settlements_commit_dispatcher_mark(uuid, integer, date, text, timestamptz, text, jsonb) from public;
grant execute on function settlements_commit_dispatcher_mark(uuid, integer, date, text, timestamptz, text, jsonb) to service_role;
