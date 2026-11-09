'use server';
import { supabaseServer, DEFAULT_COMPANY_ID } from './supabase-server';

// Recorridos "quitados" de la lista de Cargas (pedido explícito, grupo Lázaro):
// clave = chofer + día en que salió de FL. Solo oculta; no toca ninguna carga.
export async function getTripDismissals(companyId = DEFAULT_COMPANY_ID): Promise<string[]> {
  const { data, error } = await supabaseServer().from('trip_dismissals').select('driver_id, trip_start').eq('company_id', companyId);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => `${r.driver_id}|${r.trip_start}`);
}

export async function setTripDismissed(driverId: string, tripStart: string, dismissed: boolean, companyId = DEFAULT_COMPANY_ID): Promise<string[]> {
  if (!driverId || !/^\d{4}-\d{2}-\d{2}$/.test(tripStart)) throw new Error('Recorrido no válido.');
  const supabase = supabaseServer();
  const result = dismissed
    ? await supabase.from('trip_dismissals').upsert({ company_id: companyId, driver_id: driverId, trip_start: tripStart }, { onConflict: 'company_id,driver_id,trip_start' })
    : await supabase.from('trip_dismissals').delete().eq('company_id', companyId).eq('driver_id', driverId).eq('trip_start', tripStart);
  if (result.error) throw new Error(result.error.message);
  return getTripDismissals(companyId);
}
