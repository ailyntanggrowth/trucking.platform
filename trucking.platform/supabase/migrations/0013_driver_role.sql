-- Rol "Chofer" (driver): choferes reales con cuenta de acceso (login por link
-- mágico, igual que el resto), pero con visibilidad restringida a lo suyo.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.
--
-- profiles.driver_id liga la cuenta de acceso con su registro real en
-- "drivers" (Choferes y Flota) — un chofer solo puede ver las cargas donde
-- loads.driver_id = profiles.driver_id, filtrado siempre del lado del
-- servidor a partir de su propia sesión (nunca de un parámetro que mande el
-- navegador) — ver lib/loads-actions.ts:listMyLoads.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('owner','admin','contabilidad','gerente','dispatcher','consulta','driver'));

alter table profiles add column if not exists driver_id uuid references drivers(id) on delete set null;
create index if not exists profiles_driver_id_idx on profiles (driver_id);
