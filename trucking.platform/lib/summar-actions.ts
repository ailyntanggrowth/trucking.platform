'use server';
// Server Actions del botón "Subir Summar", separadas de lib/loads-actions.ts
// a propósito (ver historial: esto ya rompió una vez el guardado normal de
// cargas por compartir archivo con commitLoadAction).
//
// pdfjs-dist YA NO se usa aquí. Se probó server-side (dentro de esta misma
// Server Action) y falló en producción en Vercel dos veces seguidas —
// incluso marcándolo como paquete externo en next.config.mjs — con el
// mismo error genérico de "Server Components render", a pesar de funcionar
// perfecto en local. Es una librería pensada para navegador; el entorno
// serverless de Vercel no le da lo que necesita (probablemente el worker).
// La solución real: leer el PDF DENTRO del navegador de la dueña (un
// navegador de verdad SÍ tiene todo lo que pdfjs-dist necesita) y mandar
// aquí solo el TEXTO ya extraído — esta función nunca toca el PDF en sí.
import { randomUUID } from 'node:crypto';
import { mapLoadRow, type LoadState, type PaymentStatus } from './loads';
import { parseSummarText } from './summar';
import { getLoadsState } from './loads-actions';
import { supabaseServer, DEFAULT_COMPANY_ID } from './supabase-server';

const mapRow = mapLoadRow;

const CONFLICT_MESSAGE = 'Los datos cambiaron en otro dispositivo o pestaña. Actualiza y vuelve a intentarlo.';
function asConflictError(error: { message?: string } | null) {
  if (error?.message === 'REVISION_CONFLICT') return new Error(CONFLICT_MESSAGE);
  return error ? new Error(error.message) : null;
}

// Botón "Subir Summar" (pedido explícito): en vez de que la dueña lea cada
// statement a mano y me diga qué cargas se pagaron, sube el PDF tal cual se
// lo manda Summar y el sistema propone los cambios — ella solo confirma.
// Solo busca, dentro del texto del PDF, los números de carga que YA existen
// en el sistema (nunca crea cargas nuevas a partir de un PDF, ver spec 6.5).
export type SummarDraftMatch = {
  loadId: string; loadNumber: string; driverId: string; driverName: string; group: string;
  section: string; denied: boolean; invoiceDate: string; invoiceAmount: number; escrowReserve: number; fundedAmount: number;
  currentPaymentStatus: PaymentStatus; currentAmount: number; currentAmountReceived: number; currentPaidAt: string;
};
export type SummarStatementPreview = {
  reportDate: string | null;
  actionable: SummarDraftMatch[]; // Purchased, todavía no marcadas Pagada — se proponen para aplicar
  alreadyPaid: SummarDraftMatch[]; // Purchased, pero ya estaba Pagada — solo informativo (puede tener un ajuste manual, ej. lumper)
  denied: SummarDraftMatch[]; // sección Denied — informativo, puede reaparecer luego
  other: SummarDraftMatch[]; // Held u otra sección desconocida — informativo
};

export async function parseSummarStatementAction(text: string, companyId = DEFAULT_COMPANY_ID): Promise<SummarStatementPreview> {
  if (!text || !text.trim()) throw new Error('No se pudo leer texto del PDF.');

  const supabase = supabaseServer();
  const [{ data: loadRows, error: loadsError }, { data: driverRows, error: driversError }] = await Promise.all([
    supabase.from('loads').select('*').eq('company_id', companyId).neq('status', 'Cancelada').neq('status', 'Reemplazada').eq('approval', 'Aprobada'),
    supabase.from('drivers').select('id,name,group_name').eq('company_id', companyId),
  ]);
  if (loadsError) throw new Error(loadsError.message);
  if (driversError) throw new Error(driversError.message);
  const loadsList = (loadRows ?? []).map(mapRow);
  const driverById = new Map((driverRows ?? []).map(d => [d.id as string, d]));

  const parsed = parseSummarText(text, loadsList.map(l => l.loadNumber).filter(Boolean));

  const actionable: SummarDraftMatch[] = [], alreadyPaid: SummarDraftMatch[] = [], denied: SummarDraftMatch[] = [], other: SummarDraftMatch[] = [];
  for (const m of parsed.matches) {
    const load = loadsList.find(l => l.loadNumber === m.loadNumber);
    if (!load) continue;
    const driver = driverById.get(load.driverId);
    const draft: SummarDraftMatch = {
      loadId: load.id, loadNumber: load.loadNumber, driverId: load.driverId, driverName: driver?.name || '', group: driver?.group_name || '',
      section: m.section, denied: m.denied, invoiceDate: m.invoiceDate, invoiceAmount: m.invoiceAmount, escrowReserve: m.escrowReserve, fundedAmount: m.fundedAmount,
      currentPaymentStatus: load.paymentStatus, currentAmount: load.amount, currentAmountReceived: load.amountReceived, currentPaidAt: load.paidAt,
    };
    if (m.denied) denied.push(draft);
    else if (!/purchased/i.test(m.section)) other.push(draft);
    else if (load.paymentStatus === 'Pagada') alreadyPaid.push(draft);
    else actionable.push(draft);
  }
  return { reportDate: parsed.reportDate, actionable, alreadyPaid, denied, other };
}

export type SummarApplyInput = { loadId: string; invoiceAmount: number; fundedAmount: number };
export type SummarApplyResult = { applied: number; state: LoadState };

// Confirma el lote (pedido explícito: revisar y confirmar, nunca aplicar
// solo). paidAt se fija a la fecha del PROPIO statement ("For: ..."), nunca
// al momento en que se confirma en el navegador — de eso depende en qué
// semana de invoice cae cada carga (ver lib/settlements.ts).
export async function commitSummarBatchAction(inputs: SummarApplyInput[], reportDate: string, companyId = DEFAULT_COMPANY_ID): Promise<SummarApplyResult> {
  if (!inputs.length) throw new Error('No hay cargas seleccionadas.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error('Fecha de statement inválida.');
  const supabase = supabaseServer();
  let applied = 0;
  for (const input of inputs) {
    if (input.invoiceAmount < 0 || input.fundedAmount < 0) continue;
    const { data: before, error: beforeError } = await supabase.from('loads').select('*').eq('id', input.loadId).eq('company_id', companyId).single();
    if (beforeError || !before) continue;
    const { data: meta, error: metaError } = await supabase.from('loads_meta').select('revision').eq('company_id', companyId).single();
    if (metaError || !meta) throw new Error(metaError?.message || 'No se pudo leer la revisión.');
    const paidAt = `${reportDate}T12:00:00.000Z`;
    const payload = {
      id: before.id, load_number: before.load_number, broker: before.broker,
      driver_id: before.driver_id, truck_id: before.truck_id, trailer_id: before.trailer_id,
      pickup_city: before.pickup_city, pickup_state: before.pickup_state, pickup_date: before.pickup_date,
      delivery_city: before.delivery_city, delivery_state: before.delivery_state, delivery_date: before.delivery_date,
      amount: input.invoiceAmount, status: before.status, missing_pod: before.missing_pod,
      payment_status: 'Pagada', amount_received: input.fundedAmount, paid_at: paidAt,
      notes: before.notes ? `${before.notes} | Confirmado vía Summar (statement del ${reportDate}).` : `Confirmado vía Summar (statement del ${reportDate}).`,
      approval: before.approval, approved_by: before.approved_by, approved_at: before.approved_at,
      dispatcher_exempt: before.dispatcher_exempt,
    };
    const event = {
      id: randomUUID(), at: new Date().toISOString(), actor: 'Ailyn (subida de Summar)', entity_ids: [before.id],
      detail: `Confirmó el pago de la carga ${before.load_number} vía statement de Summar del ${reportDate}: $${input.invoiceAmount} facturado, $${input.fundedAmount} depositado.`,
      before, after: { ...before, amount: input.invoiceAmount, payment_status: 'Pagada', amount_received: input.fundedAmount, paid_at: paidAt },
    };
    const { error: rpcError } = await supabase.rpc('loads_commit_load', { p_company_id: companyId, p_expected_revision: meta.revision, p_load: payload, p_event: event });
    const conflict = asConflictError(rpcError);
    if (conflict) throw conflict;
    if (rpcError) throw new Error(rpcError.message);
    applied++;
  }
  const state = await getLoadsState(companyId);
  return { applied, state };
}
