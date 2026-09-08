// Módulo 2 (Cargas y Operaciones). Mismo patrón que lib/fleet.ts y lib/fuel.ts:
// estado puro + reductor validado + historial de eventos.
//
// Toda carga registrada queda oficial de inmediato (pedido explícito: se quitó
// el paso de aprobación manual — quien la registra ya confía en sus propios
// datos, no hace falta que se autoapruebe aparte). approve/reject se
// mantienen por si alguna carga vieja quedó pendiente, pero ninguna carga
// nueva pasa por ahí. Las cargas canceladas NUNCA se borran — quedan en el
// historial con motivo, quién y cuándo, y enlazadas a su reemplazo si aplica
// (replace crea una carga nueva y marca la original como Reemplazada, sin
// sobrescribirla).
import type { Load as DashboardLoad, LoadStatus as DashboardLoadStatus } from './dashboard';

export type LoadStatus = 'Programado' | 'Cargando' | 'En tránsito' | 'Entregada' | 'Pendiente de documentos' | 'Completada' | 'Cancelada' | 'Reemplazada';
export const LOAD_STATUS_VALUES: LoadStatus[] = ['Programado', 'Cargando', 'En tránsito', 'Entregada', 'Pendiente de documentos', 'Completada', 'Cancelada', 'Reemplazada'];

export type ApprovalStatus = 'Pendiente' | 'Aprobada' | 'Rechazada';
export type PaymentStatus = 'Pendiente' | 'Facturada' | 'Pagada' | 'Parcial' | 'Disputada' | 'No pagable';
export const PAYMENT_STATUS_VALUES: PaymentStatus[] = ['Pendiente', 'Facturada', 'Pagada', 'Parcial', 'Disputada', 'No pagable'];

export type Load = {
  id: string; loadNumber: string; broker: string;
  driverId: string; truckId: string; trailerId: string;
  pickupCity: string; pickupState: string; pickupDate: string;
  deliveryCity: string; deliveryState: string; deliveryDate: string;
  amount: number; status: LoadStatus; missingPod: boolean;
  // paidAt: fecha Y HORA (ISO) en que paymentStatus pasó a 'Pagada' (pedido
  // explícito) — la comisión del despachador de una semana solo cuenta las
  // cargas pagadas DENTRO de ese período; si Summar no la pagó a tiempo, la
  // carga simplemente aparece en el invoice de la semana en que sí se pague.
  // La hora importa: el lunes de cierre reparte cargas entre dos invoices
  // según si se pagaron antes o después de las 9pm — ver dispatcherCommissionDetail.
  paymentStatus: PaymentStatus; amountReceived: number; paidAt: string;
  notes: string;
  // Reporte de rotura de camión (pedido explícito): qué se rompió y cuánto
  // costó la reparación, para cuando una carga se atrasa por eso. Un solo
  // reporte "vigente" por carga, no un historial — se sobreescribe si se
  // vuelve a reportar, y se limpia mandando la nota vacía.
  incidentNote: string; incidentCost: number; incidentReportedAt: string;
  // Controladas SOLO por sus propias acciones (approve/reject/cancel/replace);
  // 'load' (crear/editar) nunca las toca directamente — ver applyLoadAction.
  approval: ApprovalStatus; approvedBy: string; approvedAt: string; rejectedReason: string;
  cancelReason: string; cancelledAt: string; cancelledBy: string;
  replacesId: string; replacedBy: string;
};

export const isOfficial = (l: Load) => l.approval === 'Aprobada' && Boolean(l.approvedBy.trim()) && Boolean(l.approvedAt);
export const isActive = (l: Load) => isOfficial(l) && ['Programado', 'Cargando', 'En tránsito', 'Pendiente de documentos'].includes(l.status);
export const balance = (l: Load) => l.amount - l.amountReceived;
export const routeLabel = (l: Load) => {
  const p = [l.pickupCity, l.pickupState].filter(Boolean).join(', ');
  const d = [l.deliveryCity, l.deliveryState].filter(Boolean).join(', ');
  return `${p || '—'} → ${d || '—'}`;
};

// Convierte al shape ligero que ya consume el Dashboard (lib/dashboard.ts).
// El Dashboard combina; el cálculo real vive aquí.
export function toDashboardLoad(l: Load): DashboardLoad {
  const statusMap: Record<LoadStatus, DashboardLoadStatus> = {
    'Programado': 'Programado', 'Cargando': 'Cargando', 'En tránsito': 'En tránsito',
    'Entregada': 'Entregada', 'Pendiente de documentos': 'Entregada', 'Completada': 'Entregada',
    'Cancelada': 'Cancelada', 'Reemplazada': 'Reemplazada',
  };
  return {
    id: l.loadNumber || l.id, route: routeLabel(l), driverId: l.driverId || undefined,
    truck: l.truckId, eta: l.pickupDate, status: statusMap[l.status],
    source: 'Manual', approval: l.approval, approvedBy: l.approvedBy || undefined, approvedAt: l.approvedAt || undefined,
    broker: l.broker || undefined, amount: l.amount || undefined,
    replacedBy: l.replacedBy || undefined, missingPod: l.missingPod || undefined,
  };
}

export type LoadEvent = { id: string; at: string; actor: string; entityIds: string[]; detail: string; before: unknown; after: unknown };
export type LoadState = { schema: 1; revision: number; loads: Load[]; events: LoadEvent[] };
export const emptyLoads: LoadState = { schema: 1, revision: 0, loads: [], events: [] };

export type LoadAction =
  | { type: 'load'; record: Load; reason: string }
  | { type: 'approve'; id: string; reason: string }
  | { type: 'reject'; id: string; reason: string }
  | { type: 'cancel'; id: string; reason: string }
  | { type: 'replace'; id: string; replacement: Load; reason: string }
  | { type: 'incident'; id: string; note: string; cost: number };

const requireValue = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function applyLoadAction(original: LoadState, action: LoadAction, now: string, id: string): LoadState {
  const state = structuredClone(original);
  let before: unknown = null, after: unknown = null, detail = '', entityIds: string[] = [];

  if (action.type === 'load') {
    const incoming = { ...action.record };
    (Object.keys(incoming) as (keyof Load)[]).forEach(k => { if (typeof incoming[k] === 'string') (incoming as unknown as Record<string, unknown>)[k] = (incoming[k] as string).trim(); });
    requireValue(incoming.id && isDate(incoming.pickupDate), 'La fecha de recogida no es válida.');
    requireValue(!incoming.deliveryDate || isDate(incoming.deliveryDate), 'La fecha de entrega no es válida.');
    requireValue(LOAD_STATUS_VALUES.includes(incoming.status), 'Estado operativo inválido.');
    requireValue(PAYMENT_STATUS_VALUES.includes(incoming.paymentStatus), 'Estado de pago inválido.');
    requireValue(incoming.amount >= 0 && incoming.amountReceived >= 0, 'Los montos no pueden ser negativos.');
    requireValue(incoming.driverId || incoming.truckId || incoming.broker || incoming.loadNumber, 'Indica al menos chofer, camión, broker o número de carga.');
    const old = state.loads.find(l => l.id === incoming.id); before = old || null;
    requireValue(!old || action.reason.trim(), 'Escribe el motivo del cambio.');
    // paidAt se calcula aquí, nunca lo manda el cliente: si ya estaba pagada
    // y sigue pagada, se conserva la fecha original; si acaba de pasar a
    // pagada, es hoy; si deja de estar pagada, se borra.
    const paidAt = incoming.paymentStatus === 'Pagada'
      ? (old && old.paymentStatus === 'Pagada' ? old.paidAt : now)
      : '';
    // La cancelación/reemplazo/reporte de rotura nunca se tocan por esta
    // vía — solo por sus propias acciones. Al crear, la carga queda
    // aprobada de una vez.
    const record: Load = old
      ? { ...incoming, paidAt, approval: old.approval, approvedBy: old.approvedBy, approvedAt: old.approvedAt, rejectedReason: old.rejectedReason, cancelReason: old.cancelReason, cancelledAt: old.cancelledAt, cancelledBy: old.cancelledBy, replacesId: old.replacesId, replacedBy: old.replacedBy, incidentNote: old.incidentNote, incidentCost: old.incidentCost, incidentReportedAt: old.incidentReportedAt }
      : { ...incoming, paidAt, approval: 'Aprobada', approvedBy: 'Automático al registrar', approvedAt: now, rejectedReason: '', cancelReason: '', cancelledAt: '', cancelledBy: '', replacesId: '', replacedBy: '', incidentNote: '', incidentCost: 0, incidentReportedAt: '' };
    state.loads = old ? state.loads.map(l => l.id === record.id ? record : l) : [...state.loads, record];
    entityIds = [record.id]; after = record;
    detail = `${old ? 'Actualizó' : 'Registró'} carga ${record.loadNumber || record.id}${old ? `: ${action.reason.trim()}` : ''}`;
  } else if (action.type === 'approve') {
    const load = state.loads.find(l => l.id === action.id); requireValue(load, 'No se encontró la carga.');
    requireValue(load!.approval !== 'Aprobada', 'Esta carga ya está aprobada.');
    before = { approval: load!.approval }; load!.approval = 'Aprobada'; load!.approvedBy = 'Usuario local · sin cuenta autenticada'; load!.approvedAt = now; load!.rejectedReason = '';
    after = { approval: load!.approval, approvedBy: load!.approvedBy, approvedAt: load!.approvedAt };
    entityIds = [action.id]; detail = `Aprobó carga ${load!.loadNumber || load!.id}`;
  } else if (action.type === 'reject') {
    requireValue(action.reason.trim(), 'Escribe el motivo del rechazo.');
    const load = state.loads.find(l => l.id === action.id); requireValue(load, 'No se encontró la carga.');
    before = { approval: load!.approval }; load!.approval = 'Rechazada'; load!.rejectedReason = action.reason.trim(); load!.approvedBy = ''; load!.approvedAt = '';
    after = { approval: load!.approval, rejectedReason: load!.rejectedReason };
    entityIds = [action.id]; detail = `Rechazó carga ${load!.loadNumber || load!.id}: ${action.reason.trim()}`;
  } else if (action.type === 'cancel') {
    requireValue(action.reason.trim(), 'Escribe el motivo de la cancelación.');
    const load = state.loads.find(l => l.id === action.id); requireValue(load, 'No se encontró la carga.');
    requireValue(load!.status !== 'Cancelada', 'Esta carga ya está cancelada.');
    before = { status: load!.status }; load!.status = 'Cancelada'; load!.cancelReason = action.reason.trim(); load!.cancelledAt = now; load!.cancelledBy = 'Usuario local · sin cuenta autenticada';
    after = { status: load!.status, cancelReason: load!.cancelReason };
    entityIds = [action.id]; detail = `Canceló carga ${load!.loadNumber || load!.id}: ${action.reason.trim()}`;
  } else if (action.type === 'replace') {
    requireValue(action.reason.trim(), 'Escribe el motivo del reemplazo.');
    const original = state.loads.find(l => l.id === action.id); requireValue(original, 'No se encontró la carga original.');
    const replacement: Load = {
      ...action.replacement, id: action.replacement.id, paidAt: action.replacement.paymentStatus === 'Pagada' ? now : '',
      approval: 'Aprobada', approvedBy: 'Automático al registrar', approvedAt: now, rejectedReason: '',
      cancelReason: '', cancelledAt: '', cancelledBy: '', replacesId: original!.id, replacedBy: '',
      incidentNote: '', incidentCost: 0, incidentReportedAt: '',
    };
    const wasCancelled = Boolean(original!.cancelledAt);
    before = { status: original!.status }; original!.status = 'Reemplazada'; original!.replacedBy = replacement.id;
    if (!wasCancelled) { original!.cancelReason = action.reason.trim(); original!.cancelledAt = now; original!.cancelledBy = 'Usuario local · sin cuenta autenticada'; }
    state.loads.push(replacement);
    after = { originalStatus: original!.status, replacementId: replacement.id };
    entityIds = [original!.id, replacement.id];
    detail = `Reemplazó carga ${original!.loadNumber || original!.id} con ${replacement.loadNumber || replacement.id}: ${action.reason.trim()}`;
  } else {
    // Reporte de rotura de camión (pedido explícito): qué se rompió y cuánto
    // costó, para cuando una carga se atrasa por una avería. Mandar la nota
    // vacía limpia el reporte (por ejemplo, ya se resolvió).
    const load = state.loads.find(l => l.id === action.id); requireValue(load, 'No se encontró la carga.');
    before = { incidentNote: load!.incidentNote, incidentCost: load!.incidentCost, incidentReportedAt: load!.incidentReportedAt };
    const note = action.note.trim();
    if (note) {
      requireValue(action.cost >= 0, 'El costo no puede ser negativo.');
      load!.incidentNote = note; load!.incidentCost = action.cost; load!.incidentReportedAt = now;
      detail = `Reportó rotura en carga ${load!.loadNumber || load!.id}: ${note}${action.cost ? ` (${action.cost})` : ''}`;
    } else {
      load!.incidentNote = ''; load!.incidentCost = 0; load!.incidentReportedAt = '';
      detail = `Quitó el reporte de rotura de la carga ${load!.loadNumber || load!.id}`;
    }
    after = { incidentNote: load!.incidentNote, incidentCost: load!.incidentCost, incidentReportedAt: load!.incidentReportedAt };
    entityIds = [action.id];
  }

  state.revision++; state.events.unshift({ id: `event-${id}`, at: now, actor: 'Usuario local · sin cuenta autenticada', entityIds, detail, before, after });
  return state;
}

// Totales de un rango [start,end). Módulo 2 expone su propio cálculo; el
// Dashboard/Reportes solo deben combinarlo, nunca recalcularlo.
export function summarizeLoads(state: LoadState, start: string, end: string) {
  const inRange = (d: string) => d >= start && d < end;
  const official = state.loads.filter(isOfficial);
  const review = state.loads.filter(l => l.approval === 'Pendiente' && l.status !== 'Cancelada' && l.status !== 'Reemplazada');
  const active = official.filter(isActive);
  const gross = official.filter(l => inRange(l.pickupDate) && l.status !== 'Cancelada').reduce((s, l) => s + l.amount, 0);
  const receivable = official.filter(l => l.paymentStatus !== 'Pagada' && l.paymentStatus !== 'No pagable').reduce((s, l) => s + balance(l), 0);
  return { official, review, active, gross, receivable };
}
