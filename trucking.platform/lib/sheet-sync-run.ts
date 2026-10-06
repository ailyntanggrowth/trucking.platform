// Lógica compartida de la sincronización con la Hoja de Google de cargas —
// la usan tanto el Cron diario (app/api/sheet-sync/route.ts) como el botón
// "Sincronizar Google Sheets" del módulo de Cargas (lib/sheet-sync-actions.ts).
// No es 'use server' porque no la llama el navegador directamente — solo
// código de servidor la importa.
//
// Lee TODAS las pestañas del archivo (una por semana, pedido explícito: "no
// quiero un archivo diferente cada semana") en cada corrida — nunca asume
// que una semana ya cerrada no puede volver a cambiar (pedido explícito: un
// pago puede llegar días después y ella vuelve a esa pestaña vieja a
// marcarlo). Si una fila falla, se anota el error y se sigue con las demás
// — una fila mala nunca detiene la sincronización completa.
import { randomUUID } from 'node:crypto';
import { parseSheetRows, matchDriver } from './sheet-sync';
import { fetchAllPrivateSheetTabs } from './google-sheets';
import { supabaseServer, DEFAULT_COMPANY_ID } from './supabase-server';

export type SheetSyncResult = {
  dryRun: boolean; totalRows: number;
  created: string[]; updated: string[]; unchanged: number; skippedNoDriver: string[];
  createdDrivers: string[]; unparsed: string[]; errors: string[];
};

export async function runSheetSync(dryRun: boolean, companyId = DEFAULT_COMPANY_ID): Promise<SheetSyncResult> {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!serviceAccountJson) throw new Error('Falta la variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON en Vercel.');
  if (!sheetId) throw new Error('Falta la variable de entorno GOOGLE_SHEET_ID en Vercel.');

  const tabs = await fetchAllPrivateSheetTabs(sheetId, serviceAccountJson);

  const supabase = supabaseServer();
  const [{ data: drivers, error: driversError }, { data: loadRows, error: loadsError }] = await Promise.all([
    supabase.from('drivers').select('id,name,card_alias').eq('company_id', companyId).eq('active', true),
    supabase.from('loads').select('*').eq('company_id', companyId).neq('status', 'Cancelada').neq('status', 'Reemplazada'),
  ]);
  if (driversError) throw new Error(driversError.message);
  if (loadsError) throw new Error(loadsError.message);
  const loadByNumber = new Map((loadRows ?? []).map(l => [l.load_number, l]));
  // Copia mutable (pedido explícito, 29 sep: "el día que a mí me dé la gana
  // poner el nombre de otro chofer... necesito que el sistema me la
  // reconozca") — un chofer que la sincronización crea a partir de una fila
  // se agrega aquí para que las DEMÁS filas de esa misma corrida (u otras
  // pestañas) ya lo encuentren, sin esperar a la próxima sincronización.
  const driversCache = [...(drivers ?? [])];

  const created: string[] = [], updated: string[] = [], skippedNoDriver: string[] = [], createdDrivers: string[] = [], unparsed: string[] = [], errors: string[] = [];
  let unchanged = 0, totalRows = 0;

  for (const tab of tabs) {
    const { rows, unparsed: tabUnparsed, skipped } = parseSheetRows(tab.rows, { titleHint: tab.title });
    if (skipped) continue; // pestaña que no parece ser de cargas (ej. otra pestaña de la dueña)
    totalRows += rows.length;
    for (const u of tabUnparsed) unparsed.push(`[${tab.title}] ${u.reason}`);

    for (const row of rows) {
      try {
        let driver = matchDriver(row.driverNameRaw, driversCache);
        if (!driver) {
          // Nunca se salta la fila por falta de chofer (pedido explícito):
          // se crea el chofer solo, con el nombre y el grupo tal como
          // vienen en la hoja, y se sigue con la carga en la misma corrida.
          // Un nombre mal tipeado crea un chofer nuevo separado — por eso
          // queda siempre visible en "createdDrivers" para que ella lo note
          // y lo corrija.
          if (dryRun) { skippedNoDriver.push(`[${tab.title}] ${row.loadNumber} (chofer "${row.driverNameRaw}" no encontrado — se crearía al confirmar)`); continue; }
          const driverId = randomUUID(); const driverNow = new Date().toISOString();
          const driverPayload = {
            id: driverId, name: row.driverNameRaw, phone: '', email: '', group_name: row.group,
            active: true, availability: 'Disponible', notes: `Registrado automáticamente desde la Hoja de Google (pestaña "${tab.title}").`, card_alias: '',
          };
          const { data: fleetMeta, error: fleetMetaError } = await supabase.from('fleet_meta').select('revision').eq('company_id', companyId).single();
          if (fleetMetaError) throw new Error(fleetMetaError.message);
          const driverEvent = {
            id: randomUUID(), at: driverNow, actor: 'Hoja de Google (sincronización)', entity_ids: [driverId],
            detail: `Registró al chofer "${row.driverNameRaw}" (grupo ${row.group}) desde la Hoja de Google (pestaña "${tab.title}").`, before: null, after: driverPayload,
          };
          const { error: driverRpcError } = await supabase.rpc('fleet_commit_driver', { p_company_id: companyId, p_expected_revision: fleetMeta!.revision, p_driver: driverPayload, p_event: driverEvent });
          if (driverRpcError) throw new Error(driverRpcError.message);
          driver = { id: driverId, name: row.driverNameRaw };
          driversCache.push({ ...driver, card_alias: null });
          createdDrivers.push(`[${tab.title}] ${row.driverNameRaw} (grupo ${row.group})`);
        }
        const existing = loadByNumber.get(row.loadNumber);
        const paymentStatus = row.paid ? 'Pagada' : (existing?.payment_status === 'Pagada' ? 'Pagada' : 'Pendiente');

        if (existing) {
          const samePaid = existing.payment_status === 'Pagada';
          const noChange = existing.driver_id === driver.id && Number(existing.amount) === row.amount
            && existing.pickup_state === row.pickupState && existing.delivery_state === row.deliveryState
            && existing.pickup_date === row.pickupDate && existing.delivery_date === row.deliveryDate
            && (row.paid ? samePaid : true); // solo importa la transición a pagada, nunca "despagar" desde la hoja
          if (noChange) { unchanged++; continue; }

          updated.push(`[${tab.title}] ${row.loadNumber}`);
          if (dryRun) continue;
          const paidAt = row.paid ? (samePaid ? existing.paid_at : new Date().toISOString()) : existing.paid_at;
          const payload = {
            id: existing.id, load_number: existing.load_number, broker: existing.broker,
            driver_id: driver.id, truck_id: existing.truck_id, trailer_id: existing.trailer_id,
            pickup_city: existing.pickup_city, pickup_state: row.pickupState, pickup_date: row.pickupDate,
            delivery_city: existing.delivery_city, delivery_state: row.deliveryState, delivery_date: row.deliveryDate,
            amount: row.amount, status: existing.status, missing_pod: existing.missing_pod,
            payment_status: paymentStatus, amount_received: existing.amount_received, paid_at: paidAt,
            notes: existing.notes, approval: existing.approval, approved_by: existing.approved_by, approved_at: existing.approved_at,
            dispatcher_exempt: existing.dispatcher_exempt,
          };
          const { data: meta, error: metaError } = await supabase.from('loads_meta').select('revision').eq('company_id', companyId).single();
          if (metaError) throw new Error(metaError.message);
          const event = {
            id: randomUUID(), at: new Date().toISOString(), actor: 'Hoja de Google (sincronización)', entity_ids: [existing.id],
            detail: `Actualizó la carga ${row.loadNumber} desde la Hoja de Google (pestaña "${tab.title}").`, before: existing, after: { ...existing, ...payload },
          };
          const { error: rpcError } = await supabase.rpc('loads_commit_load', { p_company_id: companyId, p_expected_revision: meta!.revision, p_load: payload, p_event: event });
          if (rpcError) throw new Error(rpcError.message);
          loadByNumber.set(row.loadNumber, { ...existing, ...payload }); // para que otra fila de OTRA pestaña con el mismo número (mismo pase) lo vea actualizado y no cree un duplicado
        } else {
          created.push(`[${tab.title}] ${row.loadNumber}`);
          if (dryRun) continue;
          const id = randomUUID(); const now = new Date().toISOString();
          const payload = {
            id, load_number: row.loadNumber, broker: '',
            driver_id: driver.id, truck_id: null, trailer_id: null,
            pickup_city: '', pickup_state: row.pickupState, pickup_date: row.pickupDate,
            delivery_city: '', delivery_state: row.deliveryState, delivery_date: row.deliveryDate,
            amount: row.amount, status: 'Programado', missing_pod: false,
            payment_status: paymentStatus, amount_received: 0, paid_at: row.paid ? now : null,
            notes: `Registrada automáticamente desde la Hoja de Google (pestaña "${tab.title}").`,
            approval: 'Aprobada', approved_by: 'Automático (Hoja de Google)', approved_at: now,
            dispatcher_exempt: false,
          };
          const { data: meta, error: metaError } = await supabase.from('loads_meta').select('revision').eq('company_id', companyId).single();
          if (metaError) throw new Error(metaError.message);
          const event = {
            id: randomUUID(), at: now, actor: 'Hoja de Google (sincronización)', entity_ids: [id],
            detail: `Registró la carga ${row.loadNumber} desde la Hoja de Google (pestaña "${tab.title}").`, before: null, after: payload,
          };
          const { error: rpcError } = await supabase.rpc('loads_commit_load', { p_company_id: companyId, p_expected_revision: meta!.revision, p_load: payload, p_event: event });
          if (rpcError) throw new Error(rpcError.message);
          loadByNumber.set(row.loadNumber, payload);
        }
      } catch (e) {
        // Una fila con error nunca detiene la sincronización completa
        // (pedido explícito) — se anota y se sigue con las demás.
        errors.push(`[${tab.title}] ${row.loadNumber || '(sin número)'}: ${(e as Error).message}`);
      }
    }
  }

  return { dryRun, totalRows, created, updated, unchanged, skippedNoDriver, createdDrivers, unparsed, errors };
}
