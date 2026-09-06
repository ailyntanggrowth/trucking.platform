-- Agrega un alias opcional por chofer: el nombre con el que a veces aparece
-- en la tarjeta de combustible (p.ej. Mudflap) en vez de su nombre real —
-- caso real: Osley aparece como "Raul Franc" en la tarjeta. Sin esto, la
-- importación de statements no lo reconoce y hay que asignarlo a mano cada vez.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.

alter table drivers add column if not exists card_alias text not null default '';

create or replace function fleet_commit_driver(
  p_company_id uuid, p_expected_revision integer, p_driver jsonb, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fleet_bump_revision(p_company_id, p_expected_revision);
  insert into drivers (id, company_id, name, phone, email, group_name, active, availability, notes, card_alias, updated_at)
  values (
    (p_driver->>'id')::uuid, p_company_id, p_driver->>'name', p_driver->>'phone', p_driver->>'email',
    p_driver->>'group_name', (p_driver->>'active')::boolean, p_driver->>'availability', p_driver->>'notes',
    coalesce(p_driver->>'card_alias',''), now()
  )
  on conflict (id) do update set
    name = excluded.name, phone = excluded.phone, email = excluded.email, group_name = excluded.group_name,
    active = excluded.active, availability = excluded.availability, notes = excluded.notes,
    card_alias = excluded.card_alias, updated_at = now();
  perform fleet_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;
