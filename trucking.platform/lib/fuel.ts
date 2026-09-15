// Módulo 4 (Combustible y Gastos). Mismo patrón que lib/fleet.ts: estado puro +
// reductor validado + historial de eventos. driverId/truckId son solo referencias
// (Módulo 3 ya existe); loadRef es texto libre porque Módulo 2 (Cargas) aún no
// tiene tablas reales — cuando las tenga, esto pasa a ser un vínculo real.
import type { Driver } from './fleet';
export type TxStatus = 'Pendiente' | 'Final';
export const TX_STATUS_VALUES: TxStatus[] = ['Pendiente', 'Final'];

export const EXPENSE_CATEGORIES = [
  'Peajes', 'Reparaciones', 'Mantenimiento', 'Estacionamiento', 'Básculas',
  'Permisos', 'Lavado de camión', 'Otro gasto de chofer', 'Gasto de compañía',
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export type FuelTransaction = {
  id: string; date: string; driverId: string; truckId: string; loadRef: string;
  station: string; city: string; state: string; gallons: number; pricePerGallon: number;
  fuelAmount: number; nonFuelAmount: number;
  // Precio de lista antes del ahorro de Mudflap (spec: "Total sin descuento"
  // del resumen semanal por grupo). 0 si la transacción no vino de un statement
  // de Mudflap o no tuvo ahorro — nunca negativo, nunca menor que fuelAmount.
  retailAmount: number;
  // Lunes de inicio del período del STATEMENT al que pertenece esta
  // transacción (pedido explícito) — no siempre coincide con la semana de
  // `date`: un statement "del 7 al 13" puede traer transacciones fechadas
  // uno o dos días antes por rezago normal de Mudflap, y deben seguir
  // contando en esa semana para que el resumen cuadre con el total oficial
  // impreso en el PDF. Para transacciones manuales (sin PDF), es la semana
  // de su propia fecha (ver fuelWeekStartOf en lib/settlements.ts).
  statementWeek: string;
  status: TxStatus; externalRef: string; notes: string;
};
export const txTotal = (t: FuelTransaction) => t.fuelAmount + t.nonFuelAmount;

export type Expense = {
  id: string; category: ExpenseCategory; amount: number; date: string;
  driverId: string; truckId: string; loadRef: string; paymentMethod: string; notes: string; status: TxStatus;
  receiptFilename?: string; receiptSizeBytes?: number; receiptUploadedAt?: string;
};

export type FuelEvent = { id: string; at: string; actor: string; entityIds: string[]; detail: string; before: unknown; after: unknown };
export type FuelState = { schema: 1; revision: number; transactions: FuelTransaction[]; expenses: Expense[]; events: FuelEvent[] };
export const emptyFuel: FuelState = { schema: 1, revision: 0, transactions: [], expenses: [], events: [] };

export type FuelAction =
  | { type: 'transaction'; record: FuelTransaction; reason: string }
  | { type: 'expense'; record: Expense; receiptFile?: Blob; reason: string }
  | { type: 'delete'; kind: 'transaction' | 'expense'; id: string; reason: string };

const requireValue = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const round2 = (n: number) => Math.round(n * 100) / 100;

export function applyFuelAction(original: FuelState, action: FuelAction, now: string, id: string): FuelState {
  const state = structuredClone(original);
  let before: unknown = null, after: unknown = null, detail = '', entityIds: string[] = [];
  if (action.type === 'transaction') {
    const record = { ...action.record };
    (Object.keys(record) as (keyof FuelTransaction)[]).forEach(k => { if (typeof record[k] === 'string') (record as unknown as Record<string, unknown>)[k] = (record[k] as string).trim(); });
    requireValue(record.id && isDate(record.date), 'La fecha de la visita no es válida.');
    requireValue(isDate(record.statementWeek), 'No se pudo determinar la semana del statement de esta transacción.');
    requireValue(TX_STATUS_VALUES.includes(record.status), 'Estado de transacción inválido.');
    requireValue(record.gallons >= 0 && record.pricePerGallon >= 0 && record.fuelAmount >= 0 && record.nonFuelAmount >= 0 && record.retailAmount >= 0, 'Los montos y galones no pueden ser negativos.');
    requireValue(record.driverId || record.truckId || record.station, 'Indica al menos chofer, camión o estación.');
    const old = state.transactions.find(t => t.id === record.id); before = old || null;
    requireValue(!old || action.reason.trim(), 'Escribe el motivo del cambio.');
    state.transactions = old ? state.transactions.map(t => t.id === record.id ? record : t) : [...state.transactions, record];
    entityIds = [record.id]; after = record;
    detail = `${old ? 'Actualizó' : 'Registró'} transacción de combustible ${record.station || record.externalRef || record.id}${old ? `: ${action.reason.trim()}` : ''}`;
  } else if (action.type === 'expense') {
    const record = { ...action.record };
    (Object.keys(record) as (keyof Expense)[]).forEach(k => { if (typeof record[k] === 'string') (record as unknown as Record<string, unknown>)[k] = (record[k] as string).trim(); });
    requireValue(record.id && EXPENSE_CATEGORIES.includes(record.category), 'Selecciona una categoría válida.');
    requireValue(isDate(record.date), 'La fecha del gasto no es válida.');
    requireValue(record.amount >= 0, 'El monto no puede ser negativo.');
    requireValue(TX_STATUS_VALUES.includes(record.status), 'Estado inválido.');
    requireValue(!action.receiptFile || (action.receiptFile.size > 0 && action.receiptFile.size <= 5 * 1024 * 1024), 'El recibo debe pesar hasta 5 MB.');
    requireValue(!action.receiptFile || ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(action.receiptFile.type), 'Usa PDF, JPG, PNG o WebP para el recibo.');
    const old = state.expenses.find(e => e.id === record.id); before = old || null;
    requireValue(!old || action.reason.trim(), 'Escribe el motivo del cambio.');
    state.expenses = old ? state.expenses.map(e => e.id === record.id ? record : e) : [...state.expenses, record];
    entityIds = [record.id]; after = record;
    detail = `${old ? 'Actualizó' : 'Registró'} gasto de ${record.category}${old ? `: ${action.reason.trim()}` : ''}`;
  } else {
    requireValue(action.reason.trim(), 'Escribe el motivo de la eliminación.');
    if (action.kind === 'transaction') {
      const record = state.transactions.find(t => t.id === action.id); requireValue(record, 'No se encontró la transacción.');
      before = record; after = null; state.transactions = state.transactions.filter(t => t.id !== action.id);
      detail = `Eliminó transacción de combustible: ${action.reason.trim()}`;
    } else {
      const record = state.expenses.find(e => e.id === action.id); requireValue(record, 'No se encontró el gasto.');
      before = record; after = null; state.expenses = state.expenses.filter(e => e.id !== action.id);
      detail = `Eliminó gasto: ${action.reason.trim()}`;
    }
    entityIds = [action.id];
  }
  state.revision++; state.events.unshift({ id: `event-${id}`, at: now, actor: 'Usuario local · sin cuenta autenticada', entityIds, detail, before, after });
  return state;
}

// Totales de un rango [start, end). Combustible/Reportes (Módulos 4 y 6) exponen
// su propio cálculo; el Dashboard solo debe combinarlos, nunca recalcularlos.
export function summarizeFuel(state: FuelState, start: string, end: string) {
  const inRange = (d: string) => d >= start && d < end;
  const transactions = state.transactions.filter(t => inRange(t.date));
  const expenses = state.expenses.filter(e => inRange(e.date));
  const fuel = transactions.reduce((s, t) => s + t.fuelAmount, 0);
  const nonFuel = transactions.reduce((s, t) => s + t.nonFuelAmount, 0);
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
  return { transactions, expenses, fuel, nonFuel, expenseTotal };
}

// Resumen semanal de Mudflap por grupo de flota (pedido explícito: es el mismo
// "Resumen de Mudflap" que la dueña le manda a Mario cada lunes por WhatsApp).
// Se agrupa por driver.group, nunca por texto libre — un chofer sin grupo
// asignado cae aparte, nunca se inventa un grupo para él. El monto de cada
// chofer es Fuel + Non-Fuel sumados (pedido explícito: no se muestran por
// separado en este resumen) y se agrupa por `statementWeek`, NO por `date` —
// ver el comentario en el tipo FuelTransaction.
export const FUEL_GROUPS = ['Mario', 'Owner Operators', 'Lázaro', 'Dionisio'] as const;
export type FuelDriverLine = { driverId: string; driverName: string; amount: number; retailAmount: number };
export type FuelGroupSummary = { group: string; drivers: FuelDriverLine[]; total: number; retailTotal: number };
export function computeWeeklyFuelSummary(state: FuelState, drivers: Driver[], statementWeek: string) {
  const transactions = state.transactions.filter(t => t.statementWeek === statementWeek && t.status === 'Final');
  const driverGroup = (id: string) => drivers.find(d => d.id === id)?.group || '';
  const driverName = (id: string) => drivers.find(d => d.id === id)?.name || '';
  const driverIds = Array.from(new Set(transactions.filter(t => t.driverId).map(t => t.driverId)));
  const groupsPresent = [...FUEL_GROUPS, ''].filter(g => driverIds.some(id => driverGroup(id) === g));

  const groups: FuelGroupSummary[] = groupsPresent.map(group => {
    const ids = driverIds.filter(id => driverGroup(id) === group);
    // Se ordena en el mismo orden en que el chofer está registrado en Flota
    // (pedido implícito: mismo orden que ella usa siempre en su lista) — nunca
    // por monto, para que el resumen no salte de posición semana a semana.
    const orderedIds = drivers.filter(d => ids.includes(d.id)).map(d => d.id);
    const lines: FuelDriverLine[] = orderedIds.map(driverId => {
      const own = transactions.filter(t => t.driverId === driverId);
      return {
        driverId, driverName: driverName(driverId) || '(sin nombre)',
        amount: own.reduce((s, t) => s + txTotal(t), 0),
        retailAmount: own.reduce((s, t) => s + (t.retailAmount || txTotal(t)), 0),
      };
    }).filter(d => d.amount > 0); // nunca choferes con total $0 (pedido explícito)
    return { group, drivers: lines, total: lines.reduce((s, d) => s + d.amount, 0), retailTotal: lines.reduce((s, d) => s + d.retailAmount, 0) };
  }).filter(g => g.drivers.length > 0);

  const grandTotal = groups.reduce((s, g) => s + g.total, 0);
  const grandRetailTotal = groups.reduce((s, g) => s + g.retailTotal, 0);
  return { groups, grandTotal, grandRetailTotal, grandDiscount: round2(grandRetailTotal - grandTotal) };
}
