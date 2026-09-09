// Módulo 5 (Contabilidad y Pagos). A diferencia de lib/loads.ts / lib/fleet.ts /
// lib/fuel.ts, este módulo NO es dueño del bruto ni del combustible de cada
// chofer — esos ya son dueños de Cargas y Combustible respectivamente. Aquí solo
// se calculan en vivo (para que una corrección posterior, p.ej. Summar cambiando
// el monto real de una carga, se refleje sola) y se persiste lo que sí es propio
// de este módulo: la configuración de la compañía y si una semana ya se pagó.
//
// Alcance (spec 7.3a/9.9/9.10): solo choferes del grupo "Mario" reciben
// liquidación semanal completa. Owner Operators solo reciben un reporte angosto
// (bruto + combustible, para el 12% de Mario + el reembolso). Lázaro y Dionisio
// no entran aquí en absoluto.
import { isOfficial, type Load } from './loads';
import type { FuelTransaction, Expense } from './fuel';
import { isCargoDriver, type Driver } from './fleet';

export type SettlementConfig = {
  companyDeductionPct: number; // fracción, p.ej. 0.06 = 6%
  dispatcherCommissionPct: number; // 0.04 = 4%
  tier1Max: number; tier1Pay: number; // bruto <= tier1Max -> tier1Pay
  tier2Max: number; tier2Pay: number; // bruto <= tier2Max -> tier2Pay
  tier3Pay: number; // bruto > tier2Max -> tier3Pay
  ownerOperatorCutPct: number; // 0.12 = 12%
};
export const defaultSettlementConfig: SettlementConfig = {
  companyDeductionPct: 0.06, dispatcherCommissionPct: 0.04,
  tier1Max: 8000, tier1Pay: 2200, tier2Max: 10000, tier2Pay: 2500, tier3Pay: 3000,
  ownerOperatorCutPct: 0.12,
};

// amountPaid: lo que Mario REALMENTE le pagó al chofer (pedido explícito) —
// puede ser distinto al salario estimado por tramos (por ejemplo, le paga
// menos y compensa el resto en efectivo por fuera del sistema), así que la
// ganancia real de Mario se calcula con este monto, no con el estimado.
export type PaymentMark = { driverId: string; weekStart: string; paymentStatus: 'Pendiente' | 'Pagada'; paidAt: string; amountPaid: number; notes: string };
// El invoice del despachador se marca aparte de los de los choferes (pedido
// explícito): quien controla si ya se le pagó a Gleybis es un Administrador
// — Mario/Ney Mario —, nunca ella misma desde Mi Invoice.
export type DispatcherInvoiceMark = { weekStart: string; paymentStatus: 'Pendiente' | 'Pagada'; paidAt: string; notes: string };
export type SettlementEvent = { id: string; at: string; actor: string; entityIds: string[]; detail: string; before: unknown; after: unknown };
// El cierre de la semana ya NO es automático a una hora fija (pedido
// explícito: un feriado corre el cierre, y forzarlo por fecha/hora no
// aguanta excepciones) — un Administrador cierra la semana a mano, cuando
// quiera, y esa fecha/hora exacta es la que reparte cargas pagadas entre el
// invoice que cierra y el siguiente.
export type WeekLock = { weekEnd: string; lockedAt: string };
export type SettlementState = {
  schema: 1; revision: number; config: SettlementConfig;
  driverInsurance: Record<string, number>; marks: PaymentMark[]; dispatcherMarks: DispatcherInvoiceMark[]; weekLocks: WeekLock[]; events: SettlementEvent[];
};
export const emptySettlements: SettlementState = {
  schema: 1, revision: 0, config: defaultSettlementConfig, driverInsurance: {}, marks: [], dispatcherMarks: [], weekLocks: [], events: [],
};

export type SettlementAction =
  | { type: 'config'; config: SettlementConfig }
  | { type: 'insurance'; driverId: string; amount: number }
  | { type: 'mark'; driverId: string; driverName: string; weekStart: string; paymentStatus: 'Pendiente' | 'Pagada'; notes: string; amountPaid?: number }
  | { type: 'dispatcherMark'; weekStart: string; paymentStatus: 'Pendiente' | 'Pagada'; notes: string }
  | { type: 'closeWeek'; weekEnd: string }
  | { type: 'reopenWeek'; weekEnd: string };

// Número de invoice del despachador (pedido explícito): invoice #41 cerró el
// 31 de agosto de 2026 — de ahí se cuenta hacia adelante o hacia atrás, una
// semana = un número, sin importar cuántas cargas tenga.
const INVOICE_ANCHOR_WEEK_START = '2026-08-24';
const INVOICE_ANCHOR_NUMBER = 41;
export function invoiceNumberFor(weekStart: string): number {
  const [y1, m1, d1] = INVOICE_ANCHOR_WEEK_START.split('-').map(Number);
  const [y2, m2, d2] = weekStart.split('-').map(Number);
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  return INVOICE_ANCHOR_NUMBER + Math.round(days / 7);
}

const requireValue = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

export function applySettlementAction(original: SettlementState, action: SettlementAction, now: string, id: string): SettlementState {
  const state = structuredClone(original);
  let before: unknown = null, after: unknown = null, detail = '', entityIds: string[] = [];

  if (action.type === 'config') {
    const c = action.config;
    requireValue([c.companyDeductionPct, c.dispatcherCommissionPct, c.ownerOperatorCutPct].every(v => v >= 0 && v <= 1), 'Los porcentajes deben estar entre 0% y 100%.');
    requireValue(c.tier1Max > 0 && c.tier2Max > c.tier1Max, 'Los tramos de bruto deben ser crecientes y mayores a cero.');
    requireValue([c.tier1Pay, c.tier2Pay, c.tier3Pay].every(v => v >= 0), 'Los pagos por tramo no pueden ser negativos.');
    before = state.config; state.config = c; after = c;
    entityIds = ['config']; detail = 'Actualizó la configuración de Contabilidad y Pagos';
  } else if (action.type === 'insurance') {
    requireValue(action.driverId, 'Falta el chofer.');
    requireValue(action.amount >= 0, 'El seguro semanal no puede ser negativo.');
    before = { amount: state.driverInsurance[action.driverId] || 0 };
    state.driverInsurance[action.driverId] = action.amount;
    after = { amount: action.amount };
    entityIds = [action.driverId]; detail = `Actualizó el seguro semanal del chofer a ${action.amount}`;
  } else if (action.type === 'mark') {
    requireValue(action.driverId && action.weekStart, 'Falta el chofer o la semana.');
    const existing = state.marks.find(m => m.driverId === action.driverId && m.weekStart === action.weekStart);
    before = existing || null;
    // Si esta acción no manda un monto (ej. el toggle simple de Contabilidad),
    // se conserva el que ya hubiera — así no se borra un pago real que se
    // haya anotado desde el recorrido de chofer en Cargas.
    const amountPaid = action.amountPaid !== undefined ? action.amountPaid : (existing?.amountPaid ?? 0);
    const mark: PaymentMark = { driverId: action.driverId, weekStart: action.weekStart, paymentStatus: action.paymentStatus, paidAt: action.paymentStatus === 'Pagada' ? now : '', amountPaid, notes: action.notes.trim() };
    state.marks = existing ? state.marks.map(m => m === existing ? mark : m) : [...state.marks, mark];
    after = mark; entityIds = [action.driverId];
    detail = `Marcó la semana del ${action.weekStart} de ${action.driverName} como ${action.paymentStatus}${amountPaid ? ` ($${amountPaid} pagado)` : ''}`;
  } else if (action.type === 'dispatcherMark') {
    requireValue(action.weekStart, 'Falta la semana.');
    const existing = state.dispatcherMarks.find(m => m.weekStart === action.weekStart);
    before = existing || null;
    const mark: DispatcherInvoiceMark = { weekStart: action.weekStart, paymentStatus: action.paymentStatus, paidAt: action.paymentStatus === 'Pagada' ? now : '', notes: action.notes.trim() };
    state.dispatcherMarks = existing ? state.dispatcherMarks.map(m => m === existing ? mark : m) : [...state.dispatcherMarks, mark];
    after = mark; entityIds = ['dispatcher'];
    detail = `Marcó el invoice #${invoiceNumberFor(action.weekStart)} del despachador (semana del ${action.weekStart}) como ${action.paymentStatus}`;
  } else if (action.type === 'closeWeek') {
    requireValue(action.weekEnd, 'Falta la semana.');
    requireValue(!state.weekLocks.some(w => w.weekEnd === action.weekEnd), 'Esta semana ya está cerrada.');
    const lock: WeekLock = { weekEnd: action.weekEnd, lockedAt: now };
    before = null; state.weekLocks = [...state.weekLocks, lock]; after = lock;
    entityIds = ['weekLock']; detail = `Cerró el invoice de la semana que termina el ${action.weekEnd} (${new Date(now).toLocaleString('es')})`;
  } else {
    requireValue(action.weekEnd, 'Falta la semana.');
    const existing = state.weekLocks.find(w => w.weekEnd === action.weekEnd);
    requireValue(existing, 'Esta semana no estaba cerrada.');
    before = existing; state.weekLocks = state.weekLocks.filter(w => w !== existing); after = null;
    entityIds = ['weekLock']; detail = `Reabrió el invoice de la semana que termina el ${action.weekEnd}`;
  }

  state.revision++; state.events.unshift({ id: `event-${id}`, at: now, actor: 'Usuario local · sin cuenta autenticada', entityIds, detail, before, after });
  return state;
}

export const driverPayForGross = (gross: number, config: SettlementConfig) => {
  if (gross <= 0) return 0;
  if (gross <= config.tier1Max) return config.tier1Pay;
  if (gross <= config.tier2Max) return config.tier2Pay;
  return config.tier3Pay;
};

// Semana lunes→lunes (spec 9.9: aproximación de calendario para el ciclo Florida,
// hasta que existan marcadores EMPIEZA/TERMINA reales por carga).
// La semana del negocio va de MARTES a LUNES (pedido explícito: el invoice se
// cierra el lunes) — no de lunes a domingo como el estándar ISO. Por eso el
// "día 1" de la semana aquí es martes, no lunes.
export function weekStartOf(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const diffToTuesday = (dt.getDay() + 5) % 7;
  dt.setDate(dt.getDate() - diffToTuesday);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export function weekRange(weekStart: string) {
  const [y, m, d] = weekStart.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(start); end.setDate(start.getDate() + 7);
  const prev = new Date(start); prev.setDate(start.getDate() - 7);
  const next = new Date(start); next.setDate(start.getDate() + 7);
  const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { start: weekStart, end: fmt(end), prevWeek: fmt(prev), nextWeek: fmt(next) };
}

// El cierre de una semana ya no es automático a una hora fija (pedido
// explícito: un feriado corre el cierre, y una hora fija no aguanta
// excepciones) — un Administrador la cierra a mano, cuando quiera, desde
// Contabilidad y Pagos. Antes de cerrarla, la semana se puede seguir
// marcando/editando.
export function isWeekLocked(weekEnd: string, weekLocks: WeekLock[]): boolean {
  return weekLocks.some(w => w.weekEnd === weekEnd);
}
function lockedAtFor(weekEnd: string, weekLocks: WeekLock[]): string | null {
  return weekLocks.find(w => w.weekEnd === weekEnd)?.lockedAt ?? null;
}

// Reparte una carga pagada el mismo día del cierre entre DOS invoices según
// la HORA exacta en que se cerró la semana (pedido explícito): lo pagado
// antes del cierre cae en el invoice que se cerró (weekEnd de ESTE período);
// lo pagado después ya es del invoice de la semana siguiente, todavía
// abierta. Mientras la semana no se cierre, el día límite es AMBIGUO entre
// las dos semanas que lo comparten — por defecto se lo queda la semana que
// se está cerrando (la más vieja), nunca las dos a la vez, hasta que se
// cierre esa semana con una hora exacta.
function paidWithinInvoicePeriod(paidAt: string, weekStart: string, weekEnd: string, weekLocks: WeekLock[]): boolean {
  if (!paidAt) return false;
  const paidDate = paidAt.slice(0, 10);
  if (paidDate < weekStart) return false;
  if (paidDate > weekEnd) return false;
  if (paidDate === weekStart) {
    // weekStart de ESTE período = weekEnd del período anterior (que
    // comparte ese mismo día límite). Solo cuenta aquí si esa semana
    // anterior ya se cerró y el pago llegó DESPUÉS de esa hora de cierre.
    const lockedAt = lockedAtFor(weekStart, weekLocks);
    if (!lockedAt) return false;
    return new Date(paidAt) > new Date(lockedAt);
  }
  if (paidDate < weekEnd) return true;
  const lockedAt = lockedAtFor(weekEnd, weekLocks);
  if (!lockedAt) return true;
  return new Date(paidAt) <= new Date(lockedAt);
}

const inRange = (date: string, start: string, end: string) => date >= start && date < end;
// "Bruto Mario" de arriba (pedido explícito): solo lo YA pagado por Summar
// esa semana, no todo lo recogido — distinto al bruto por chofer de la
// tabla (que sigue por fecha de recogida, para no mover el tramo de pago).
export function marioPaidGross(drivers: Driver[], loads: Load[], weekStart: string, weekEnd: string, weekLocks: WeekLock[]): number {
  const marioIds = new Set(drivers.filter(d => d.group === 'Mario').map(d => d.id));
  return loads
    .filter(l => marioIds.has(l.driverId) && isOfficial(l) && l.status !== 'Cancelada' && l.paymentStatus === 'Pagada' && paidWithinInvoicePeriod(l.paidAt, weekStart, weekEnd, weekLocks))
    .reduce((s, l) => s + l.amount, 0);
}
const fuelAndExpenses = (driverId: string, transactions: FuelTransaction[], expenses: Expense[], start: string, end: string) =>
  transactions.filter(t => t.driverId === driverId && t.status === 'Final' && inRange(t.date, start, end)).reduce((s, t) => s + t.fuelAmount + t.nonFuelAmount, 0)
  + expenses.filter(e => e.driverId === driverId && e.status === 'Final' && inRange(e.date, start, end)).reduce((s, e) => s + e.amount, 0);
const grossFor = (driverId: string, loads: Load[], start: string, end: string) =>
  loads.filter(l => l.driverId === driverId && isOfficial(l) && l.status !== 'Cancelada' && inRange(l.pickupDate, start, end)).reduce((s, l) => s + l.amount, 0);

export type MarioSettlement = {
  driverId: string; driverName: string; loadsCount: number;
  gross: number; companyDeduction: number; fuel: number; driverPay: number; insurance: number; finalProfit: number;
  paymentStatus: 'Pendiente' | 'Pagada'; paidAt: string; notes: string;
};
export function computeMarioSettlements(
  drivers: Driver[], loads: Load[], transactions: FuelTransaction[], expenses: Expense[],
  weekStart: string, weekEnd: string, config: SettlementConfig, driverInsurance: Record<string, number>, marks: PaymentMark[],
): MarioSettlement[] {
  return drivers.filter(d => d.group === 'Mario').map(d => {
    const loadsCount = loads.filter(l => l.driverId === d.id && isOfficial(l) && l.status !== 'Cancelada' && inRange(l.pickupDate, weekStart, weekEnd)).length;
    const gross = grossFor(d.id, loads, weekStart, weekEnd);
    const fuel = fuelAndExpenses(d.id, transactions, expenses, weekStart, weekEnd);
    const companyDeduction = gross * config.companyDeductionPct;
    const driverPay = driverPayForGross(gross, config);
    const insurance = driverInsurance[d.id] || 0;
    const finalProfit = gross - companyDeduction - fuel - driverPay - insurance;
    const mark = marks.find(m => m.driverId === d.id && m.weekStart === weekStart);
    return {
      driverId: d.id, driverName: d.name, loadsCount, gross, companyDeduction, fuel, driverPay, insurance, finalProfit,
      paymentStatus: mark?.paymentStatus || 'Pendiente', paidAt: mark?.paidAt || '', notes: mark?.notes || '',
    };
  }).sort((a, b) => b.gross - a.gross);
}

// netPayout: lo que Mario realmente le paga al Owner Operator esa semana. No es
// solo "88% del bruto" — el chofer gastó el combustible con la tarjeta de la
// compañía (Mudflap), así que Mario se lo descuenta de su parte antes de pagarle.
export type OwnerOperatorSettlement = { driverId: string; driverName: string; loadsCount: number; gross: number; marioCut: number; fuel: number; driverShare: number; netPayout: number };
export function computeOwnerOperatorSettlements(
  drivers: Driver[], loads: Load[], transactions: FuelTransaction[], expenses: Expense[],
  weekStart: string, weekEnd: string, config: SettlementConfig,
): OwnerOperatorSettlement[] {
  return drivers.filter(d => d.group === 'Owner Operators').map(d => {
    const loadsCount = loads.filter(l => l.driverId === d.id && isOfficial(l) && l.status !== 'Cancelada' && inRange(l.pickupDate, weekStart, weekEnd)).length;
    const gross = grossFor(d.id, loads, weekStart, weekEnd);
    const fuel = fuelAndExpenses(d.id, transactions, expenses, weekStart, weekEnd);
    const marioCut = gross * config.ownerOperatorCutPct;
    const driverShare = gross - marioCut;
    return { driverId: d.id, driverName: d.name, loadsCount, gross, marioCut, fuel, driverShare, netPayout: driverShare - fuel };
  }).sort((a, b) => b.gross - a.gross);
}

// Comisión del despachador: 4% sobre el bruto de Mario + Owner Operators + Lázaro
// de la semana, todo junto en un solo número (pedido explícito). Es un pago
// aparte — nunca se resta del salario del chofer.
//
// Una carga solo entra en el invoice de LA SEMANA EN QUE SE PAGÓ, nunca la
// semana en que se recogió/entregó (pedido explícito): si el broker ("Summar")
// no la paga a tiempo, no se pierde — simplemente cae sola en el invoice de
// la semana en que sí llegue el pago, gracias a que se agrupa por paidAt.
//
// La dispatcher no tiene acceso a Contabilidad y Pagos (solo Cargas, Chat y
// su Invoice) — por eso este detalle por carga vive aquí también: sin él no
// tendría cómo comprobar que el total de su comisión es correcto más que
// sumando a mano en Cargas (pedido explícito de la dueña).
export type DispatcherCommissionLine = { loadId: string; loadNumber: string; driverName: string; group: string; amount: number; commission: number };
export function dispatcherCommissionDetail(drivers: Driver[], loads: Load[], weekStart: string, weekEnd: string, config: SettlementConfig, weekLocks: WeekLock[] = []) {
  const eligible = drivers.filter(d => d.group === 'Mario' || d.group === 'Owner Operators' || d.group === 'Lázaro');
  const eligibleById = new Map(eligible.map(d => [d.id, d]));
  const rows: DispatcherCommissionLine[] = loads
    .filter(l => eligibleById.has(l.driverId) && isOfficial(l) && l.status !== 'Cancelada' && l.paymentStatus === 'Pagada' && paidWithinInvoicePeriod(l.paidAt, weekStart, weekEnd, weekLocks))
    .map(l => ({ loadId: l.id, loadNumber: l.loadNumber, driverName: eligibleById.get(l.driverId)!.name, group: eligibleById.get(l.driverId)!.group, amount: l.amount, commission: l.amount * config.dispatcherCommissionPct }))
    // Agrupado por chofer (pedido explícito: todas las cargas de Agnel juntas,
    // luego las de Dixon, etc.) — dentro de cada chofer, la más grande primero.
    .sort((a, b) => a.driverName.localeCompare(b.driverName) || b.amount - a.amount);
  const gross = rows.reduce((s, r) => s + r.amount, 0);
  return { rows, gross, commission: gross * config.dispatcherCommissionPct };
}
export function dispatcherCommission(drivers: Driver[], loads: Load[], weekStart: string, weekEnd: string, config: SettlementConfig, weekLocks: WeekLock[] = []) {
  const { gross, commission } = dispatcherCommissionDetail(drivers, loads, weekStart, weekEnd, config, weekLocks);
  return { gross, commission };
}

// Grupo Lázaro: reporte angosto solo para ver su bruto (entra en la comisión
// del despachador de arriba). Lázaro les paga aparte, fuera de este sistema —
// los choferes de este grupo que no cargan (ej. los que solo aparecen en el
// statement de combustible) simplemente no tienen cargas y salen en cero.
export type LazaroSettlement = { driverId: string; driverName: string; loadsCount: number; gross: number };
export function computeLazaroSettlements(drivers: Driver[], loads: Load[], weekStart: string, weekEnd: string): LazaroSettlement[] {
  return drivers.filter(d => d.group === 'Lázaro' && isCargoDriver(d)).map(d => {
    const loadsCount = loads.filter(l => l.driverId === d.id && isOfficial(l) && l.status !== 'Cancelada' && inRange(l.pickupDate, weekStart, weekEnd)).length;
    return { driverId: d.id, driverName: d.name, loadsCount, gross: grossFor(d.id, loads, weekStart, weekEnd) };
  }).sort((a, b) => b.gross - a.gross);
}
