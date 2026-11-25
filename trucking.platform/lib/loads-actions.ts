'use server';
import { randomUUID } from 'node:crypto';
import { applyLoadAction, mapLoadRow, type Load, type LoadAction, type LoadState } from './loads';
import { supabaseServer } from './supabase-server';
import { requireCaller, STAFF, STAFF_OR_DISPATCHER } from './auth-guard';
import { fetchAllRows } from './fetch-all';

const CONFLICT_MESSAGE = 'Los datos cambiaron en otro dispositivo o pestaña. Actualiza y vuelve a intentarlo.';

function asConflictError(error: { message?: string } | null) {
  if (error?.message === 'REVISION_CONFLICT') return new Error(CONFLICT_MESSAGE);
  return error ? new Error(error.message) : null;
}

const mapRow = mapLoadRow;

// Solo para el rol 'driver': cada chofer ve ÚNICAMENTE sus propias cargas.
// El driver_id nunca sale del cliente — se resuelve aquí mismo a partir de
// la sesión (auth.getUser) y del profiles.driver_id ya guardado, así que ni
// modificando la URL, parámetros o llamando esta función a mano se puede
// pedir/leer la carga de otro chofer.
export async function listMyLoads(accessToken: string): Promise<Load[]> {
  const caller = await requireCaller(accessToken, ['driver']);
  if (!caller.driverId) throw new Error('Tu cuenta no tiene un chofer vinculado.');
  const supabase = supabaseServer();
  const { data, error } = await supabase.from('loads').select('*').eq('company_id', caller.companyId).eq('driver_id', caller.driverId).order('pickup_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

async function loadLoadsState(companyId: string): Promise<LoadState> {
  const supabase = supabaseServer();
  const [meta, loads, events] = await Promise.all([
    supabase.from('loads_meta').select('revision').eq('company_id', companyId).single(),
    fetchAllRows((a, b) => supabase.from('loads').select('*').eq('company_id', companyId).order('id').range(a, b)),
    fetchAllRows((a, b) => supabase.from('load_events').select('*').eq('company_id', companyId).order('seq', { ascending: false }).range(a, b)),
  ]);
  for (const result of [meta, loads, events]) if (result.error) throw new Error(result.error.message);
  return {
    schema: 1, revision: meta.data!.revision,
    loads: (loads.data ?? []).map(mapRow),
    events: (events.data ?? []).map(r => ({ id: r.id, at: r.at, actor: r.actor, entityIds: r.entity_ids, detail: r.detail, before: r.before, after: r.after })),
  };
}

function eventPayload(next: LoadState) {
  const e = next.events[0];
  return { id: e.id, at: e.at, actor: e.actor, entity_ids: e.entityIds, detail: e.detail, before: e.before, after: e.after };
}

function loadPayload(l: Load) {
  return {
    id: l.id, load_number: l.loadNumber, broker: l.broker,
    driver_id: l.driverId || null, truck_id: l.truckId || null, trailer_id: l.trailerId || null,
    pickup_city: l.pickupCity, pickup_state: l.pickupState, pickup_date: l.pickupDate,
    delivery_city: l.deliveryCity, delivery_state: l.deliveryState, delivery_date: l.deliveryDate || null,
    amount: l.amount, status: l.status, missing_pod: l.missingPod,
    payment_status: l.paymentStatus, amount_received: l.amountReceived, paid_at: l.paidAt || null, notes: l.notes,
    // Bug corregido (pedido explícito, la dueña registró una carga desde el
    // sistema y no le salía): applyLoadAction ya calcula approval='Aprobada'
    // para una carga nueva, pero este payload nunca lo mandaba a Supabase —
    // la carga se guardaba con el default de la columna ('Pendiente') y
    // quedaba invisible en cualquier vista que filtre por isOfficial().
    approval: l.approval, approved_by: l.approvedBy, approved_at: l.approvedAt || null,
    dispatcher_exempt: l.dispatcherExempt,
  };
}

export async function commitLoadAction(accessToken: string, action: LoadAction, expectedRevision: number): Promise<LoadState> {
  const { companyId } = await requireCaller(accessToken, STAFF);
  const supabase = supabaseServer();
  const state = await loadLoadsState(companyId);
  const now = new Date().toISOString();
  const id = randomUUID();
  const next = applyLoadAction(state, action, now, id);
  const event = eventPayload(next);
  let rpc;

  if (action.type === 'load') {
    const l = next.loads.find(x => x.id === action.record.id)!;
    rpc = supabase.rpc('loads_commit_load', { p_company_id: companyId, p_expected_revision: expectedRevision, p_load: loadPayload(l), p_event: event });
  } else if (action.type === 'approve') {
    const l = next.loads.find(x => x.id === action.id)!;
    rpc = supabase.rpc('loads_commit_approve', { p_company_id: companyId, p_expected_revision: expectedRevision, p_id: action.id, p_approved_by: l.approvedBy, p_approved_at: l.approvedAt, p_event: event });
  } else if (action.type === 'reject') {
    const l = next.loads.find(x => x.id === action.id)!;
    rpc = supabase.rpc('loads_commit_reject', { p_company_id: companyId, p_expected_revision: expectedRevision, p_id: action.id, p_reason: l.rejectedReason, p_event: event });
  } else if (action.type === 'cancel') {
    const l = next.loads.find(x => x.id === action.id)!;
    rpc = supabase.rpc('loads_commit_cancel', { p_company_id: companyId, p_expected_revision: expectedRevision, p_id: action.id, p_reason: l.cancelReason, p_cancelled_by: l.cancelledBy, p_cancelled_at: l.cancelledAt, p_event: event });
  } else if (action.type === 'replace') {
    const original = next.loads.find(x => x.id === action.id)!;
    const replacement = next.loads.find(x => x.replacesId === action.id)!;
    rpc = supabase.rpc('loads_commit_replace', {
      p_company_id: companyId, p_expected_revision: expectedRevision, p_original_id: action.id, p_reason: original.cancelReason,
      p_cancelled_by: original.cancelledBy, p_cancelled_at: original.cancelledAt, p_replacement: loadPayload(replacement), p_event: event,
    });
  } else {
    const l = next.loads.find(x => x.id === action.id)!;
    rpc = supabase.rpc('loads_commit_incident', {
      p_company_id: companyId, p_expected_revision: expectedRevision, p_id: action.id,
      p_note: l.incidentNote, p_cost: l.incidentCost, p_reported_at: l.incidentReportedAt || null, p_event: event,
    });
  }

  const { data: newRevision, error } = await rpc;
  const conflict = asConflictError(error);
  if (conflict) throw conflict;
  next.revision = newRevision as number;
  return next;
}

export async function getLoadsState(accessToken: string): Promise<LoadState> {
  const { companyId } = await requireCaller(accessToken, STAFF_OR_DISPATCHER);
  return loadLoadsState(companyId);
}
