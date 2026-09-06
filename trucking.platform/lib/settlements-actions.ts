'use server';
import { randomUUID } from 'node:crypto';
import { applySettlementAction, type SettlementAction, type SettlementConfig, type SettlementState } from './settlements';
import { supabaseServer, DEFAULT_COMPANY_ID } from './supabase-server';

const CONFLICT_MESSAGE = 'Los datos cambiaron en otro dispositivo o pestaña. Actualiza y vuelve a intentarlo.';

function asConflictError(error: { message?: string } | null) {
  if (error?.message === 'REVISION_CONFLICT') return new Error(CONFLICT_MESSAGE);
  return error ? new Error(error.message) : null;
}

function mapConfig(r: Record<string, any>): SettlementConfig {
  return {
    companyDeductionPct: Number(r.company_deduction_pct), dispatcherCommissionPct: Number(r.dispatcher_commission_pct),
    tier1Max: Number(r.tier1_max), tier1Pay: Number(r.tier1_pay),
    tier2Max: Number(r.tier2_max), tier2Pay: Number(r.tier2_pay), tier3Pay: Number(r.tier3_pay),
    ownerOperatorCutPct: Number(r.owner_operator_cut_pct),
  };
}
function configPayload(c: SettlementConfig) {
  return {
    company_deduction_pct: c.companyDeductionPct, dispatcher_commission_pct: c.dispatcherCommissionPct,
    tier1_max: c.tier1Max, tier1_pay: c.tier1Pay, tier2_max: c.tier2Max, tier2_pay: c.tier2Pay, tier3_pay: c.tier3Pay,
    owner_operator_cut_pct: c.ownerOperatorCutPct,
  };
}

export async function getSettlementsState(companyId = DEFAULT_COMPANY_ID): Promise<SettlementState> {
  const supabase = supabaseServer();
  const [meta, config, insurance, marks, events] = await Promise.all([
    supabase.from('settlements_meta').select('revision').eq('company_id', companyId).single(),
    supabase.from('settlements_config').select('*').eq('company_id', companyId).single(),
    supabase.from('driver_settlement_settings').select('*').eq('company_id', companyId),
    supabase.from('settlement_marks').select('*').eq('company_id', companyId),
    supabase.from('settlement_events').select('*').eq('company_id', companyId).order('seq', { ascending: false }),
  ]);
  for (const result of [meta, config, insurance, marks, events]) if (result.error) throw new Error(result.error.message);
  const driverInsurance: Record<string, number> = {};
  for (const row of insurance.data ?? []) driverInsurance[row.driver_id] = Number(row.weekly_insurance);
  return {
    schema: 1, revision: meta.data!.revision, config: mapConfig(config.data!), driverInsurance,
    marks: (marks.data ?? []).map(r => ({ driverId: r.driver_id, weekStart: r.week_start, paymentStatus: r.payment_status, paidAt: r.paid_at ?? '', notes: r.notes })),
    events: (events.data ?? []).map(r => ({ id: r.id, at: r.at, actor: r.actor, entityIds: r.entity_ids, detail: r.detail, before: r.before, after: r.after })),
  };
}

function eventPayload(next: SettlementState) {
  const e = next.events[0];
  return { id: e.id, at: e.at, actor: e.actor, entity_ids: e.entityIds, detail: e.detail, before: e.before, after: e.after };
}

export async function commitSettlementAction(action: SettlementAction, expectedRevision: number, companyId = DEFAULT_COMPANY_ID): Promise<SettlementState> {
  const supabase = supabaseServer();
  const state = await getSettlementsState(companyId);
  const now = new Date().toISOString();
  const id = randomUUID();
  const next = applySettlementAction(state, action, now, id);
  const event = eventPayload(next);
  let rpc;

  if (action.type === 'config') {
    rpc = supabase.rpc('settlements_commit_config', { p_company_id: companyId, p_expected_revision: expectedRevision, p_config: configPayload(next.config), p_event: event });
  } else if (action.type === 'insurance') {
    rpc = supabase.rpc('settlements_commit_insurance', { p_company_id: companyId, p_expected_revision: expectedRevision, p_driver_id: action.driverId, p_amount: action.amount, p_event: event });
  } else {
    const mark = next.marks.find(m => m.driverId === action.driverId && m.weekStart === action.weekStart)!;
    rpc = supabase.rpc('settlements_commit_mark', {
      p_company_id: companyId, p_expected_revision: expectedRevision, p_driver_id: action.driverId, p_week_start: action.weekStart,
      p_payment_status: mark.paymentStatus, p_paid_at: mark.paidAt || null, p_notes: mark.notes, p_event: event,
    });
  }

  const { data: newRevision, error } = await rpc;
  const conflict = asConflictError(error);
  if (conflict) throw conflict;
  next.revision = newRevision as number;
  return next;
}
