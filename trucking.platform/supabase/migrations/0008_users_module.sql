-- Módulo 8 (Usuarios y Permisos) — esquema inicial.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.
-- No se ejecuta automáticamente: la conexión MCP de este proyecto está en modo solo lectura.
--
-- No se guarda contraseña alguna: el login es por link mágico de correo
-- (Supabase Auth, tabla auth.users, ya existe por defecto en todo proyecto).
-- Esta tabla solo guarda el perfil/rol dentro de la compañía para cada usuario
-- ya autenticado. Igual que loads/fleet/fuel/settlements, no hay políticas RLS
-- permisivas — todo el acceso pasa por funciones de servidor con la clave
-- service-role (lib/users-actions.ts), nunca directo desde el navegador.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'dispatcher' check (role in ('admin', 'dispatcher')),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_company_email_idx on profiles (company_id, lower(email));

alter table profiles enable row level security;
