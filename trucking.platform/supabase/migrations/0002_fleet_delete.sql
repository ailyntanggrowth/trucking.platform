-- Permite eliminar (de verdad, no solo desactivar) choferes, camiones/trailers y
-- documentos desde la app. El evento de auditoría de cada borrado SIEMPRE se
-- conserva en fleet_events (con antes/después), aunque la fila desaparezca de
-- su tabla — nunca se borra ni se modifica el historial de eventos aquí.
--
-- IMPORTANTE: los FK de assignments hacia drivers/equipment se cambian a
-- ON DELETE CASCADE (driver_id, truck_id) / ON DELETE SET NULL (trailer_id).
-- Esto significa que borrar un chofer o camión borra también sus asignaciones
-- (activas o históricas) — es una consecuencia esperada de un borrado real,
-- no un efecto secundario oculto. Se aplica manualmente, igual que 0001.

alter table assignments drop constraint if exists assignments_driver_id_fkey;
alter table assignments add constraint assignments_driver_id_fkey
  foreign key (driver_id) references drivers(id) on delete cascade;

alter table assignments drop constraint if exists assignments_truck_id_fkey;
alter table assignments add constraint assignments_truck_id_fkey
  foreign key (truck_id) references equipment(id) on delete cascade;

alter table assignments drop constraint if exists assignments_trailer_id_fkey;
alter table assignments add constraint assignments_trailer_id_fkey
  foreign key (trailer_id) references equipment(id) on delete set null;

create or replace function fleet_commit_delete_entity(
  p_company_id uuid, p_expected_revision integer, p_kind text, p_entity_id uuid, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fleet_bump_revision(p_company_id, p_expected_revision);
  delete from fleet_documents where owner_kind = p_kind and owner_id = p_entity_id and company_id = p_company_id;
  if p_kind = 'drivers' then
    delete from drivers where id = p_entity_id and company_id = p_company_id;
  else
    delete from equipment where id = p_entity_id and company_id = p_company_id;
  end if;
  perform fleet_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

create or replace function fleet_commit_delete_document(
  p_company_id uuid, p_expected_revision integer, p_document_id uuid, p_event jsonb
) returns integer language plpgsql as $$
declare v_new_revision integer;
begin
  v_new_revision := fleet_bump_revision(p_company_id, p_expected_revision);
  delete from fleet_documents where id = p_document_id and company_id = p_company_id;
  perform fleet_insert_event(p_company_id, p_event);
  return v_new_revision;
end $$;

revoke execute on function fleet_commit_delete_entity(uuid, integer, text, uuid, jsonb) from public;
revoke execute on function fleet_commit_delete_document(uuid, integer, uuid, jsonb) from public;
grant execute on function fleet_commit_delete_entity(uuid, integer, text, uuid, jsonb) to service_role;
grant execute on function fleet_commit_delete_document(uuid, integer, uuid, jsonb) to service_role;
