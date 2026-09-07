-- Módulo 7 (Chat) — conversaciones separadas (1 a 1 y de grupo) en vez de un
-- solo canal de toda la compañía. Aplicar manualmente en el SQL Editor de
-- Supabase, igual que las anteriores.
--
-- Migración de datos: todo lo que ya existía en "messages" se conserva — se
-- crea una conversación de grupo "General" con todos los perfiles de la
-- compañía como miembros, y los mensajes existentes quedan ligados a ella.
-- No se borra ni se inventa nada.

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text,
  is_group boolean not null default false,
  created_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default '1970-01-01T00:00:00Z',
  joined_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);
create index if not exists conversation_members_profile_idx on conversation_members (profile_id);

alter table messages add column if not exists conversation_id uuid references conversations(id) on delete cascade;
create index if not exists messages_conversation_id_created_at_idx on messages (conversation_id, created_at);

alter table conversations enable row level security;
alter table conversation_members enable row level security;

do $$
declare
  c record;
  new_conv_id uuid;
begin
  for c in select distinct company_id from profiles loop
    if not exists (select 1 from conversations where company_id = c.company_id and name = 'General') then
      insert into conversations (company_id, name, is_group, created_by)
      select c.company_id, 'General', true, id from profiles where company_id = c.company_id order by created_at asc limit 1
      returning id into new_conv_id;

      insert into conversation_members (conversation_id, profile_id)
      select new_conv_id, id from profiles where company_id = c.company_id;

      update messages set conversation_id = new_conv_id where company_id = c.company_id and conversation_id is null;
    end if;
  end loop;
end $$;

alter table messages alter column conversation_id set not null;
