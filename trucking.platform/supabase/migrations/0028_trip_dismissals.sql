-- "Quitar" un recorrido de la lista de Cargas (pedido explícito, grupo Lázaro):
-- cuando ya no se necesita ver el viaje de un chofer, se oculta. La clave es
-- el chofer + el día en que salió de FL (el inicio del viaje), así que si el
-- chofer sale de nuevo, ese viaje nuevo SÍ aparece. Es un simple "ocultar":
-- no borra ni cambia ninguna carga.
-- Aplicar manualmente en el SQL Editor de Supabase, igual que las anteriores.

create table if not exists trip_dismissals (
  company_id uuid not null references companies(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  trip_start date not null,
  dismissed_at timestamptz not null default now(),
  primary key (company_id, driver_id, trip_start)
);
alter table trip_dismissals enable row level security;
