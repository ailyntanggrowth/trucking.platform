-- Módulo 8 (Usuarios y Permisos) — agrega el rol 'owner'.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.
--
-- Pedido directo de la dueña: no todos los 'admin' deben poder tocar Usuarios
-- y Permisos. 'owner' es el único con ese poder; 'admin' sigue viendo y
-- haciendo todo lo demás igual que antes.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('owner', 'admin', 'dispatcher'));
