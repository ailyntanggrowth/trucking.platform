import 'server-only';
import { supabaseServer } from './supabase-server';
import type { Role } from './users';

// Guardia de TODAS las funciones del servidor ('use server') que tocan datos.
//
// Por qué existe (24 nov 2026): antes, solo el chat y Usuarios y Permisos
// comprobaban quién estaba llamando; las funciones de cargas, flota,
// combustible y cuentas respondían a cualquiera y usaban siempre la compañía
// M&A. Con una segunda compañía (Lázaro) eso dejaría ver los datos de una
// desde la otra. Ahora cada función recibe el access_token de la sesión, lo
// valida contra Supabase Auth y toma la COMPAÑÍA y el ROL del perfil de quien
// llama — el navegador nunca elige la compañía.
export type Caller = { id: string; companyId: string; role: Role; driverId: string | null; name: string };

// Quién puede qué (igual que la interfaz: moduleAccessByRole en app/page.tsx).
export const STAFF: Role[] = ['owner', 'admin'];
export const STAFF_OR_DISPATCHER: Role[] = ['owner', 'admin', 'dispatcher'];
export const ANY_ROLE: Role[] = ['owner', 'admin', 'dispatcher', 'driver'];

export async function requireCaller(accessToken: string | null | undefined, allowed: Role[]): Promise<Caller> {
  if (!accessToken) throw new Error('Sesión inválida o vencida. Vuelve a entrar.');
  const supabase = supabaseServer();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) throw new Error('Sesión inválida o vencida. Vuelve a entrar.');
  const { data: profile, error } = await supabase.from('profiles').select('id, company_id, role, active, driver_id, name').eq('id', userData.user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error('Tu cuenta no tiene acceso a este sistema.');
  if (profile.active === false) throw new Error('Tu cuenta está desactivada.');
  const role = profile.role as Role;
  if (!allowed.includes(role)) throw new Error('No tienes permiso para hacer esto.');
  return { id: profile.id, companyId: profile.company_id, role, driverId: profile.driver_id ?? null, name: profile.name };
}
