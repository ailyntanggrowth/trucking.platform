import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Cliente solo-servidor: usa la clave service-role, que salta RLS.
// Nunca importar este módulo desde un componente cliente ni exponer estas
// variables con el prefijo NEXT_PUBLIC_.
export function supabaseServer() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan las variables de entorno SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  return createClient(url, key, { auth: { persistSession: false } });
}

// Single-tenant por ahora (Módulo 8 introducirá compañías reales por usuario).
// Debe coincidir con el UUID sembrado en supabase/migrations/0001_fleet_module.sql.
export const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
