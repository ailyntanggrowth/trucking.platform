-- Módulo 8 (Usuarios y Permisos) — amplía los roles de 3 a 6 y agrega un
-- estado activo/inactivo por persona (antes quitar acceso era solo borrar
-- el perfil por completo; ahora se puede desactivar sin perder el registro).
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('owner','admin','contabilidad','gerente','dispatcher','consulta'));

alter table profiles add column if not exists active boolean not null default true;
