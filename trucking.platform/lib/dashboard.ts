// Read-only projections. Operational modules own these records; never persist dashboard totals.
export type LoadStatus = 'Programado' | 'Cargando' | 'En tránsito' | 'Entregada' | 'Cancelada' | 'Reemplazada';
export type Load = {
  id: string; route: string; driverId?: string; truck: string; eta: string;
  status: LoadStatus; source: 'IA' | 'Manual';
  approval: 'Pendiente' | 'Aprobada' | 'Rechazada';
  approvedBy?: string; approvedAt?: string;
  broker?: string; amount?: number; replacedBy?: string; missingPod?: boolean;
};
export type Snapshot = {
  connected: boolean;
  loads: Load[];
  drivers: { id: string; name: string; status: 'Disponible' | 'En servicio' | 'Descanso' | 'Inactivo' }[];
  ledger: { id: string; loadId?: string; date: string; kind: 'Ingreso' | 'TONU' | 'Detention' | 'Fuel' | 'Non-Fuel' | 'Salarios'; amount: number }[];
  payments: { id: string; loadId: string; direction: 'Cobrar' | 'Pagar'; amount: number; paid: number; due: string }[];
  alerts: { id: string; title: string; detail: string }[];
  activity: { id: string; at: string; actor: string; detail: string }[];
};
export const emptySnapshot: Snapshot = { connected: false, loads: [], drivers: [], ledger: [], payments: [], alerts: [], activity: [] };
export const isOfficial = (load: Load) => load.approval === 'Aprobada' && Boolean(load.approvedBy?.trim()) && Boolean(load.approvedAt && !Number.isNaN(Date.parse(load.approvedAt)));
export const isActive = (load: Load) => isOfficial(load) && ['Programado', 'Cargando', 'En tránsito'].includes(load.status);
export function summarize(data: Snapshot, start: string, end: string) {
  const official = data.loads.filter(isOfficial);
  const review = data.loads.filter(l => l.approval !== 'Rechazada' && !isOfficial(l));
  const loadIds = new Set(official.map(l => l.id));
  const payments = data.payments.filter(p => loadIds.has(p.loadId) && p.amount > p.paid);
  const ledger = data.ledger.filter(entry => {
    if (entry.date < start || entry.date >= end) return false;
    if (!entry.loadId) return !['Ingreso', 'TONU', 'Detention'].includes(entry.kind);
    const load = official.find(l => l.id === entry.loadId);
    if (!load) return false;
    return entry.kind !== 'Ingreso' || load.status === 'Entregada';
  });
  const sum = (kind: Snapshot['ledger'][number]['kind']) => ledger.filter(e => e.kind === kind).reduce((s, e) => s + e.amount, 0);
  const gross = sum('Ingreso') + sum('TONU') + sum('Detention');
  const fuel = sum('Fuel'), nonFuel = sum('Non-Fuel'), salaries = sum('Salarios');
  return { official, review, active: official.filter(isActive), payments, gross, fuel, nonFuel, salaries, profit: gross - fuel - nonFuel - salaries,
    receivable: payments.filter(p => p.direction === 'Cobrar').reduce((s, p) => s + p.amount - p.paid, 0),
    payable: payments.filter(p => p.direction === 'Pagar').reduce((s, p) => s + p.amount - p.paid, 0) };
}
