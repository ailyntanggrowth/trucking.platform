'use server';
import { randomUUID } from 'node:crypto';
import { applyLoadAction, type Load, type LoadAction, type LoadState, type ApprovalStatus, type LoadStatus, type PaymentStatus } from './loads';
import { parseSummarText } from './summar';
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
    paymentStatus: r.payment_status as PaymentStatus, amountReceived: Number(r.amount_received), paidAt: r.paid_at ?? '', notes: r.notes,
    approval: r.approval as ApprovalStatus, approvedBy: r.approved_by, approvedAt: r.approved_at ?? '',
    rejectedReason: r.rejected_reason, cancelReason: r.cancel_reason, cancelledAt: r.cancelled_at ?? '',
    cancelledBy: r.cancelled_by, replacesId: r.replaces_id ?? '', replacedBy: r.replaced_by ?? '',
    incidentNote: r.incident_note ?? '', incidentCost: Number(r.incident_cost ?? 0), incidentReportedAt: r.incident_reported_at ?? '',
    dispatcherExempt: Boolean(r.dispatcher_exempt),
  };
}

// Solo para el rol 'driver': cada chofer ve ÚNICAMENTE sus propias cargas.
// El driver_id nunca sale del cliente — se resuelve aquí mismo a partir de
// la sesión (auth.getUser) y del profiles.driver_id ya guardado, así que ni
// modificando la URL, parámetros o llamando esta función a mano se puede
// pedir/leer la carga de otro chofer.
export async function listMyLoads(accessToken: string, companyId = DEFAULT_COMPANY_ID): Promise<Load[]> {
  const supabase = supabaseServer();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) throw new Error('Sesión inválida o vencida. Vuelve a entrar.');
  const { data: profile, error: profileError } = await supabase.from('profiles').select('role,driver_id').eq('id', userData.user.id).eq('company_id', companyId).maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile || profile.role !== 'driver' || !profile.driver_id) throw new Error('Tu cuenta no tiene un chofer vinculado.');
  const { data, error } = await supabase.from('loads').select('*').eq('company_id', companyId).eq('driver_id', profile.driver_id).order('pickup_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
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

export async function parseSummarStatementAction(formData: FormData, companyId = DEFAULT_COMPANY_ID): Promise<SummarStatementPreview> {
  const file = formData.get('statement') as File | null;
  if (!file || file.size === 0) throw new Error('Selecciona un archivo PDF.');
  if (file.type !== 'application/pdf') throw new Error('El statement debe ser un PDF.');
  if (file.size > 10 * 1024 * 1024) throw new Error('El PDF debe pesar hasta 10 MB.');

  const data = new Uint8Array(await file.arrayBuffer());
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it: unknown) => (it as { str?: string }).str || '').join(' ') + '\n';
  }

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
