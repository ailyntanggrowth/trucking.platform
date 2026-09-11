// Endpoint que sincroniza la Hoja de Google de resumen semanal con Cargas
// (pedido explícito: "la fila de la hoja sería el registro"). Lo llama un
// Cron de Vercel cada pocos minutos (ver vercel.json) — no hace falta que
// la dueña haga nada en la Hoja aparte de compartirla "cualquiera con el
// enlace puede ver" (ya lo está).
//
// Solo API route normal (no Server Action): un Cron de Vercel hace un GET
// HTTP común, no puede invocar una Server Action de Next.js.
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { parseSheetRows, matchDriver } from '../../../lib/sheet-sync';
import { supabaseServer, DEFAULT_COMPANY_ID } from '../../../lib/supabase-server';

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1gcthRZ_WkcMA89pmkPPGRu9LaI1deMWmGmER23Hv63c/export?format=csv';

// Parser CSV simple (los datos no traen comas ni comillas dentro de una
// celda, confirmado contra la hoja real) — evita traer una librería extra
// solo para esto.
function parseCsv(text: string): string[][] {
  return text.split('\n').map(line => line.replace(/\r$/, '').split(','));
}

export async function GET(request: NextRequest) {
  // CRON_SECRET es el nombre especial que reconoce Vercel: si existe esa
  // variable de entorno, Vercel agrega solo "Authorization: Bearer <valor>"
  // en cada llamada de su propio Cron — así este endpoint solo responde a
  // llamadas reales del Cron, no a cualquiera que adivine la URL.
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  const companyId = DEFAULT_COMPANY_ID;

  const res = await fetch(SHEET_CSV_URL, { cache: 'no-store' });
  if (!res.ok) return NextResponse.json({ error: `No se pudo leer la Hoja (HTTP ${res.status})` }, { status: 502 });
  const csvRows = parseCsv(await res.text());
  const { rows, unparsed } = parseSheetRows(csvRows);

  const supabase = supabaseServer();
  const [{ data: drivers, error: driversError }, { data: loadRows, error: loadsError }] = await Promise.all([
    supabase.from('drivers').select('id,name').eq('company_id', companyId).eq('active', true),
    supabase.from('loads').select('*').eq('company_id', companyId).neq('status', 'Cancelada').neq('status', 'Reemplazada'),
  ]);
  if (driversError) return NextResponse.json({ error: driversError.message }, { status: 500 });
  if (loadsError) return NextResponse.json({ error: loadsError.message }, { status: 500 });
  const loadByNumber = new Map((loadRows ?? []).map(l => [l.load_number, l]));

  const created: string[] = [], updated: string[] = [], unchanged: string[] = [], skippedNoDriver: string[] = [];

  for (const row of rows) {
    const driver = matchDriver(row.driverNameRaw, drivers ?? []);
    if (!driver) { skippedNoDriver.push(`${row.loadNumber} (chofer "${row.driverNameRaw}" no encontrado)`); continue; }
    const existing = loadByNumber.get(row.loadNumber);
    const paymentStatus = row.paid ? 'Pagada' : (existing?.payment_status === 'Pagada' ? 'Pagada' : 'Pendiente');

    if (existing) {
      const samePaid = existing.payment_status === 'Pagada';
      const noChange = existing.driver_id === driver.id && Number(existing.amount) === row.amount
        && existing.pickup_state === row.pickupState && existing.delivery_state === row.deliveryState
        && existing.pickup_date === row.pickupDate && existing.delivery_date === row.deliveryDate
        && (row.paid ? samePaid : true); // solo nos importa la transición a pagada, no "despagar" algo desde la hoja
      if (noChange) { unchanged.push(row.loadNumber); continue; }

      updated.push(row.loadNumber);
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
      const { data: meta } = await supabase.from('loads_meta').select('revision').eq('company_id', companyId).single();
      const event = {
        id: randomUUID(), at: new Date().toISOString(), actor: 'Hoja de Google (sincronización automática)', entity_ids: [existing.id],
        detail: `Actualizó la carga ${row.loadNumber} desde la Hoja de Google.`, before: existing, after: { ...existing, ...payload },
      };
      await supabase.rpc('loads_commit_load', { p_company_id: companyId, p_expected_revision: meta!.revision, p_load: payload, p_event: event });
    } else {
      created.push(row.loadNumber);
      if (dryRun) continue;
      const id = randomUUID(); const now = new Date().toISOString();
      const payload = {
        id, load_number: row.loadNumber, broker: '',
        driver_id: driver.id, truck_id: null, trailer_id: null,
        pickup_city: '', pickup_state: row.pickupState, pickup_date: row.pickupDate,
        delivery_city: '', delivery_state: row.deliveryState, delivery_date: row.deliveryDate,
        amount: row.amount, status: 'Programado', missing_pod: false,
        payment_status: paymentStatus, amount_received: 0, paid_at: row.paid ? now : null,
        notes: 'Registrada automáticamente desde la Hoja de Google de resumen semanal.',
        approval: 'Aprobada', approved_by: 'Automático (Hoja de Google)', approved_at: now,
        dispatcher_exempt: false,
      };
      const { data: meta } = await supabase.from('loads_meta').select('revision').eq('company_id', companyId).single();
      const event = {
        id: randomUUID(), at: now, actor: 'Hoja de Google (sincronización automática)', entity_ids: [id],
        detail: `Registró la carga ${row.loadNumber} desde la Hoja de Google.`, before: null, after: payload,
      };
      await supabase.rpc('loads_commit_load', { p_company_id: companyId, p_expected_revision: meta!.revision, p_load: payload, p_event: event });
    }
  }

  return NextResponse.json({
    dryRun, totalRows: rows.length,
    created, updated, unchanged: unchanged.length, skippedNoDriver, unparsed: unparsed.map(u => u.reason),
  });
}
