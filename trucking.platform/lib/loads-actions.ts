'use server';
import { randomUUID } from 'node:crypto';
import { applyLoadAction, type Load, type LoadAction, type LoadState, type ApprovalStatus, type LoadStatus, type PaymentStatus } from './loads';
import { supabaseServer, DEFAULT_COMPANY_ID } from './supabase-server';

const CONFLICT_MESSAGE = 'Los datos cambiaron en otro dispositivo o pestaña. Actualiza y vuelve a intentarlo.';

function asConflictError(error: { message?: string } | null) {
  if (error?.message === 'REVISION_CONFLICT') return new Error(CONFLICT_MESSAGE);
  return error ? new Error(error.message) : null;
}

function mapRow(r: Record<string, any>): Load {
  return {
    id: r.id, loadNumber: r.load_number, broker: r.broker,
    driverId: r.driver_id ?? '', truckId: r.truck_id ?? '', trailerId: r.trailer_id ?? '',
    pickupCity: r.pickup_city, pickupState: r.pickup_state, pickupDate: r.pickup_date,
    deliveryCity: r.delivery_city, deliveryState: r.delivery_state, deliveryDate: r.delivery_date ?? '',
    amount: Number(r.amount), status: r.status as LoadStatus, missingPod: r.missing_pod,
    paymentStatus: r.payment_status as PaymentStatus, amountReceived: Number(r.amount_received), notes: r.notes,
    approval: r.approval as ApprovalStatus, approvedBy: r.approved_by, approvedAt: r.approved_at ?? '',
    rejectedReason: r.rejected_reason, cancelReason: r.cancel_reason, cancelledAt: r.cancelled_at ?? '',
    cancelledBy: r.cancelled_by, replacesId: r.replaces_id ?? '', replacedBy: r.replaced_by ?? '',
  };
}

export async function getLoadsState(companyId = DEFAULT_COMPANY_ID): Promise<LoadState> {
  const supabase = supabaseServer();
  const [meta, loads, events] = await Promise.all([
    supabase.from('loads_meta').select('revision').eq('company_id', companyId).single(),
    supabase.from('loads').select('*').eq('company_id', companyId),
    supabase.from('load_events').select('*').eq('company_id', companyId).order('seq', { ascending: false }),
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
    payment_status: l.paymentStatus, amount_received: l.amountReceived, notes: l.notes,
  };
}

export async function commitLoadAction(action: LoadAction, expectedRevision: number, companyId = DEFAULT_COMPANY_ID): Promise<LoadState> {
  const supabase = supabaseServer();
  const state = await getLoadsState(companyId);
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
  } else {
    const original = next.loads.find(x => x.id === action.id)!;
    const replacement = next.loads.find(x => x.replacesId === action.id)!;
    rpc = supabase.rpc('loads_commit_replace', {
      p_company_id: companyId, p_expected_revision: expectedRevision, p_original_id: action.id, p_reason: original.cancelReason,
      p_cancelled_by: original.cancelledBy, p_cancelled_at: original.cancelledAt, p_replacement: loadPayload(replacement), p_event: event,
    });
  }

  const { data: newRevision, error } = await rpc;
  const conflict = asConflictError(error);
  if (conflict) throw conflict;
  next.revision = newRevision as number;
  return next;
}
