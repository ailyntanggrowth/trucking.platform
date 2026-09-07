"use client";
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cliente del navegador: usa la clave publicable (segura de exponer), nunca la
// service-role. Solo se usa para el login por link mágico y para saber la
// sesión actual — cualquier lectura/escritura real de datos sigue pasando por
// las funciones de servidor ('use server'), igual que en el resto del proyecto.
let client: SupabaseClient | null = null;
export function supabaseBrowser() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Faltan las variables de entorno NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  client = createClient(url, key);
  return client;
}
