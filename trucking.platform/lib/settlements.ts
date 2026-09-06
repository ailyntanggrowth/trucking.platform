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
import type { Driver } from './fleet';

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

export type PaymentMark = { driverId: string; weekStart: string; paymentStatus: 'Pendiente' | 'Pagada'; paidAt: string; notes: string };
export type SettlementEvent = { id: string; at: string; actor: string; entityIds: string[]; detail: string; before: unknown; after: unknown };
export type SettlementState = {
  schema: 1; revision: number; config: SettlementConfig;
  driverInsurance: Record<string, number>; marks: PaymentMark[]; events: SettlementEvent[];
};
export const emptySettlements: SettlementState = {
  schema: 1, revision: 0, config: defaultSettlementConfig, driverInsurance: {}, marks: [], events: [],
};

export type SettlementAction =
  | { type: 'config'; config: SettlementConfig }
  | { type: 'insurance'; driverId: string; amount: number }
  | { type: 'mark'; driverId: string; driverName: string; weekStart: string; paymentStatus: 'Pendiente' | 'Pagada'; notes: string };

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
  } else {
    requireValue(action.driverId && action.weekStart, 'Falta el chofer o la semana.');
    const existing = state.marks.find(m => m.driverId === action.driverId && m.weekStart === action.weekStart);
    before = existing || null;
    const mark: PaymentMark = { driverId: action.driverId, weekStart: action.weekStart, paymentStatus: action.paymentStatus, paidAt: action.paymentStatus === 'Pagada' ? now : '', notes: action.notes.trim() };
    state.marks = existing ? state.marks.map(m => m === existing ? mark : m) : [...state.marks, mark];
    after = mark; entityIds = [action.driverId];
    detail = `Marcó la semana del ${action.weekStart} de ${action.driverName} como ${action.paymentStatus}`;
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
export function weekStartOf(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const diffToMonday = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - diffToMonday);
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

const inRange = (date: string, start: string, end: string) => date >= start && date < end;
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

// Comisión del despachador: 4% sobre el bruto de Mario + Owner Operators de la
// semana (spec 9.4). Es un pago aparte — nunca se resta del salario del chofer.
export function dispatcherCommission(drivers: Driver[], loads: Load[], weekStart: string, weekEnd: string, config: SettlementConfig) {
  const eligibleIds = new Set(drivers.filter(d => d.group === 'Mario' || d.group === 'Owner Operators').map(d => d.id));
  const gross = loads.filter(l => eligibleIds.has(l.driverId) && isOfficial(l) && l.status !== 'Cancelada' && inRange(l.pickupDate, weekStart, weekEnd)).reduce((s, l) => s + l.amount, 0);
  return { gross, commission: gross * config.dispatcherCommissionPct };
}
