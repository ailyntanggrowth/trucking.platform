'use server';
import { supabaseServer } from './supabase-server';
import { requireCaller, STAFF } from './auth-guard';

// Recorridos "quitados" de la lista de Cargas (pedido explícito, grupo Lázaro):
// clave = chofer + día en que salió de FL. Solo oculta; no toca ninguna carga.
async function loadTripDismissals(companyId: string): Promise<string[]> {
  const { data, error } = await supabaseServer().from('trip_dismissals').select('driver_id, trip_start').eq('company_id', companyId);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => `${r.driver_id}|${r.trip_start}`);
}

export async function getTripDismissals(accessToken: string): Promise<string[]> {
  const { companyId } = await requireCaller(accessToken, STAFF);
  return loadTripDismissals(companyId);
}

export async function setTripDismissed(accessToken: string, driverId: string, tripStart: string, dismissed: boolean): Promise<string[]> {
  const { companyId } = await requireCaller(accessToken, STAFF);
  if (!driverId || !/^\d{4}-\d{2}-\d{2}$/.test(tripStart)) throw new Error('Recorrido no válido.');
  const supabase = supabaseServer();
  // El chofer tiene que ser de ESTA compañía (nunca se confía en el id que manda el navegador).
  const { data: own } = await supabase.from('drivers').select('id').eq('id', driverId).eq('company_id', companyId).maybeSingle();
  if (!own) throw new Error('Recorrido no válido.');
  const result = dismissed
    ? await supabase.from('trip_dismissals').upsert({ company_id: companyId, driver_id: driverId, trip_start: tripStart }, { onConflict: 'company_id,driver_id,trip_start' })
    : await supabase.from('trip_dismissals').delete().eq('company_id', companyId).eq('driver_id', driverId).eq('trip_start', tripStart);
  if (result.error) throw new Error(result.error.message);
  return loadTripDismissals(companyId);
}
