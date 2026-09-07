-- Módulo 7 (Chat / Comunicación interna) — esquema inicial.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.
--
-- Primera versión: un solo canal de toda la compañía (spec 11.2 menciona
-- canales por chofer/carga/departamento a futuro — no construidos todavía,
-- solo este canal general). Cada mensaje queda ligado al profile de quien lo
-- escribió (nunca al "Usuario local" genérico de los demás módulos, porque
-- aquí sí existe un usuario real detrás de cada sesión).

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_company_id_created_at_idx on messages (company_id, created_at);

alter table messages enable row level security;
