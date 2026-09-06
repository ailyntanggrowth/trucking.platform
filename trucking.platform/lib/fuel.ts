// Módulo 4 (Combustible y Gastos). Mismo patrón que lib/fleet.ts: estado puro +
// reductor validado + historial de eventos. driverId/truckId son solo referencias
// (Módulo 3 ya existe); loadRef es texto libre porque Módulo 2 (Cargas) aún no
// tiene tablas reales — cuando las tenga, esto pasa a ser un vínculo real.
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
  fuelAmount: number; nonFuelAmount: number; status: TxStatus; externalRef: string; notes: string;
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
  | { type: 'setStatus'; kind: 'transaction' | 'expense'; id: string; status: TxStatus; reason: string }
  | { type: 'delete'; kind: 'transaction' | 'expense'; id: string; reason: string };

const requireValue = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function applyFuelAction(original: FuelState, action: FuelAction, now: string, id: string): FuelState {
  const state = structuredClone(original);
  let before: unknown = null, after: unknown = null, detail = '', entityIds: string[] = [];
  if (action.type === 'transaction') {
    const record = { ...action.record };
    (Object.keys(record) as (keyof FuelTransaction)[]).forEach(k => { if (typeof record[k] === 'string') (record as unknown as Record<string, unknown>)[k] = (record[k] as string).trim(); });
    requireValue(record.id && isDate(record.date), 'La fecha de la visita no es válida.');
    requireValue(TX_STATUS_VALUES.includes(record.status), 'Estado de transacción inválido.');
    requireValue(record.gallons >= 0 && record.pricePerGallon >= 0 && record.fuelAmount >= 0 && record.nonFuelAmount >= 0, 'Los montos y galones no pueden ser negativos.');
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
  } else if (action.type === 'setStatus') {
    requireValue(TX_STATUS_VALUES.includes(action.status), 'Estado inválido.');
    requireValue(action.reason.trim(), 'Escribe el motivo del cambio de estado.');
    const list: (FuelTransaction | Expense)[] = action.kind === 'transaction' ? state.transactions : state.expenses;
    const record = list.find(r => r.id === action.id);
    requireValue(record, 'No se encontró el registro.');
    before = { status: record!.status }; record!.status = action.status; after = { status: record!.status };
    entityIds = [action.id];
    detail = `Marcó ${action.kind === 'transaction' ? 'transacción' : 'gasto'} como ${action.status}: ${action.reason.trim()}`;
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
  const pendingCount = transactions.filter(t => t.status === 'Pendiente').length + expenses.filter(e => e.status === 'Pendiente').length;
  return { transactions, expenses, fuel, nonFuel, expenseTotal, pendingCount };
}
