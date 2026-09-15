import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Cliente solo-servidor: usa la clave service-role, que salta RLS.
// Nunca importar este módulo desde un componente cliente ni exponer estas
// variables con el prefijo NEXT_PUBLIC_.
//
// `global.fetch` con `cache: 'no-store'` (pedido explícito, bug real): Next.js
// parchea el `fetch` global del servidor y guarda en caché las respuestas por
// defecto — sin esto, una corrección hecha directo en Supabase (o incluso un
// re-import desde la propia app) podía tardar horas en verse reflejada en
// pantalla, en cualquier dispositivo, porque el caché vive en el servidor de
// Vercel, no en el navegador de quien mira la app.
export function supabaseServer() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan las variables de entorno SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}

// Single-tenant por ahora (Módulo 8 introducirá compañías reales por usuario).
// Debe coincidir con el UUID sembrado en supabase/migrations/0001_fleet_module.sql.
export const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
