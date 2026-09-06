"use client";
import { useState, type FormEvent } from 'react';
import { EXPENSE_CATEGORIES, TX_STATUS_VALUES, summarizeFuel, txTotal, type Expense, type ExpenseCategory, type FuelAction, type FuelTransaction, type TxStatus } from '../lib/fuel';
import type { FuelController } from '../lib/use-fuel';
import { getExpenseReceiptUrl } from '../lib/fuel-actions';
import type { FleetController } from '../lib/use-fleet';
import { money, dateLabel as dateTime, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import styles from './fuel.module.css';

type Tab = 'transacciones' | 'gastos';
type Editor = { type: 'transaction' | 'expense' | 'status' | 'delete'; kind: 'transaction' | 'expense'; id: string; revision: number };
const monthStart = () => today().slice(0, 7) + '-01';
const monthEnd = () => { const d = new Date(`${monthStart()}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };
async function downloadReceipt(expense: Expense) { const url = await getExpenseReceiptUrl(expense.id); const a = document.createElement('a'); a.href = url; a.download = expense.receiptFilename || 'recibo'; a.click(); }

export default function FuelModule({ fuel, fleet, lang, t }: { fuel: FuelController; fleet: FleetController; lang: Lang; t: (es: string) => string }) {
  const { state, ready } = fuel;
  const [tab, setTab] = useState<Tab>('transacciones'), [query, setQuery] = useState(''), [statusFilter, setStatusFilter] = useState('Todos');
  const [start, setStart] = useState(monthStart()), [end, setEnd] = useState(monthEnd());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const driverName = (id: string) => fleet.state.drivers.find(d => d.id === id)?.name || '';
  const truckUnit = (id: string) => fleet.state.trucks.find(e => e.id === id)?.unit || '';
  const summary = summarizeFuel(state, start, end);

  function open(type: Editor['type'], kind: Editor['kind'], id = '') { setError(''); setNotice(''); setEditor({ type, kind, id, revision: state.revision }); requestAnimationFrame(() => document.getElementById('fuel-editor')?.scrollIntoView({ block: 'start', behavior: 'instant' })); }
  const editTx = editor?.type === 'transaction' ? state.transactions.find(x => x.id === editor.id) : undefined;
  const editExpense = editor?.type === 'expense' ? state.expenses.find(x => x.id === editor.id) : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor || busy) return; const fields = new FormData(event.currentTarget); const text = (key: string) => String(fields.get(key) || '').trim(); const num = (key: string) => Number(fields.get(key) || 0);
    setError(''); setBusy(true);
    try {
      let action: FuelAction;
      if (editor.type === 'transaction') {
        const record: FuelTransaction = { id: editor.id || crypto.randomUUID(), date: text('date'), driverId: text('driverId'), truckId: text('truckId'), loadRef: text('loadRef'), station: text('station'), city: text('city'), state: text('state'), gallons: num('gallons'), pricePerGallon: num('pricePerGallon'), fuelAmount: num('fuelAmount'), nonFuelAmount: num('nonFuelAmount'), status: text('status') as TxStatus, externalRef: text('externalRef'), notes: text('notes') };
        action = { type: 'transaction', record, reason: text('reason') };
      } else if (editor.type === 'expense') {
        const file = fields.get('receipt') as File;
        const record: Expense = { id: editor.id || crypto.randomUUID(), category: text('category') as ExpenseCategory, amount: num('amount'), date: text('date'), driverId: text('driverId'), truckId: text('truckId'), loadRef: text('loadRef'), paymentMethod: text('paymentMethod'), notes: text('notes'), status: text('status') as TxStatus, receiptFilename: editExpense?.receiptFilename };
        action = { type: 'expense', record, receiptFile: file && file.size > 0 ? file : undefined, reason: text('reason') };
      } else if (editor.type === 'status') {
        action = { type: 'setStatus', kind: editor.kind, id: editor.id, status: text('status') as TxStatus, reason: text('reason') };
      } else {
        action = { type: 'delete', kind: editor.kind, id: editor.id, reason: text('reason') };
      }
      const next = await fuel.commit(action, editor.revision);
      setEditor(null); setNotice(next.events[0].detail);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const changeTab = (next: Tab) => { setTab(next); setEditor(null); setQuery(''); setStatusFilter('Todos'); setError(''); setNotice(''); };
  const filteredTx = state.transactions.filter(t2 => `${t2.station} ${t2.city} ${t2.state} ${driverName(t2.driverId)} ${truckUnit(t2.truckId)} ${t2.externalRef}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (statusFilter === 'Todos' || t2.status === statusFilter)).sort((a, b) => b.date.localeCompare(a.date));
  const filteredExpenses = state.expenses.filter(e => `${e.category} ${driverName(e.driverId)} ${truckUnit(e.truckId)} ${e.paymentMethod}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (statusFilter === 'Todos' || e.status === statusFilter)).sort((a, b) => b.date.localeCompare(a.date));
  const editorTitle = editor?.type === 'transaction' ? `${editor.id ? t('Editar') : t('Agregar')} ${t('transacción de combustible')}` : editor?.type === 'expense' ? `${editor.id ? t('Editar') : t('Agregar')} ${t('gasto')}` : editor?.type === 'status' ? t('Cambiar estado') : t('Eliminar registro');

  return <div className={styles.fuel}>
    <div className={styles.localNotice}><strong>M&A KING</strong><p>{t('Los datos y recibos se guardan en Supabase y se sincronizan entre dispositivos. Los totales aquí no son ganancia final: faltan deducciones de Contabilidad.')}</p></div>
    {fuel.error && <div role="alert" className={styles.error}>{fuel.error} <button onClick={() => void fuel.refresh()}>{t('Reintentar')}</button></div>}
    {!ready && !fuel.error && <p role="status">{t('Abriendo los registros de combustible y gastos…')}</p>}
    <div className={styles.filters}>
      <label>{t('Desde')}<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label>{t('Hasta')}<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
    </div>
    <div className={styles.metrics}>
      <div><span>{t('Fuel')}</span><strong>{ready ? money(summary.fuel) : '—'}</strong></div>
      <div><span>{t('Non-Fuel')}</span><strong>{ready ? money(summary.nonFuel) : '—'}</strong></div>
      <div><span>{t('Otros gastos')}</span><strong>{ready ? money(summary.expenseTotal) : '—'}</strong></div>
      <div><span>{t('Pendientes de finalizar')}</span><strong>{ready ? summary.pendingCount : '—'}</strong></div>
    </div>
    <nav className={styles.tabs} aria-label={t('Secciones de combustible')}>
      <button aria-pressed={tab === 'transacciones'} onClick={() => changeTab('transacciones')}>{t('Combustible')} <span>{state.transactions.length}</span></button>
      <button aria-pressed={tab === 'gastos'} onClick={() => changeTab('gastos')}>{t('Gastos')} <span>{state.expenses.length}</span></button>
    </nav>
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    <div className={styles.toolbar}><h2>{tab === 'transacciones' ? t('Transacciones de combustible') : t('Gastos operativos')}</h2><button className={styles.primary} disabled={!ready || busy} onClick={() => open(tab === 'transacciones' ? 'transaction' : 'expense', tab === 'transacciones' ? 'transaction' : 'expense')}>{tab === 'transacciones' ? t('+ Registrar transacción') : t('+ Registrar gasto')}</button></div>

    {editor && <form id="fuel-editor" className={styles.form} onSubmit={submit} key={`${editor.type}-${editor.id}`}>
      <h3>{editorTitle}</h3>
      {editor.type === 'transaction' && <div className={styles.fields}>
        <label>{t('Fecha de la visita *')}<input name="date" type="date" required defaultValue={editTx?.date || today()} /></label>
        <label>{t('Estado *')}<select name="status" defaultValue={editTx?.status || 'Pendiente'}>{TX_STATUS_VALUES.map(s => <option key={s} value={s}>{t(s)}</option>)}</select></label>
        <label>{t('Chofer')}<select name="driverId" defaultValue={editTx?.driverId || ''}><option value="">{t('Sin asignar')}</option>{fleet.state.drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>{t('Camión')}<select name="truckId" defaultValue={editTx?.truckId || ''}><option value="">{t('Sin asignar')}</option>{fleet.state.trucks.map(e => <option key={e.id} value={e.id}>{e.unit}</option>)}</select></label>
        <label>{t('Estación')}<input name="station" maxLength={150} defaultValue={editTx?.station} /></label>
        <label>{t('Ciudad')}<input name="city" maxLength={100} defaultValue={editTx?.city} /></label>
        <label>{t('Estado (ubicación)')}<input name="state" maxLength={50} defaultValue={editTx?.state} /></label>
        <label>{t('Referencia de carga')}<input name="loadRef" maxLength={100} defaultValue={editTx?.loadRef} /></label>
        <label>{t('Galones')}<input name="gallons" type="number" step="0.001" min="0" defaultValue={editTx?.gallons ?? 0} /></label>
        <label>{t('Precio por galón')}<input name="pricePerGallon" type="number" step="0.001" min="0" defaultValue={editTx?.pricePerGallon ?? 0} /></label>
        <label>{t('Monto Fuel')}<input name="fuelAmount" type="number" step="0.01" min="0" defaultValue={editTx?.fuelAmount ?? 0} /></label>
        <label>{t('Monto Non-Fuel')}<input name="nonFuelAmount" type="number" step="0.01" min="0" defaultValue={editTx?.nonFuelAmount ?? 0} /></label>
        <label>{t('Referencia externa')}<input name="externalRef" maxLength={100} placeholder="Mudflap #" defaultValue={editTx?.externalRef} /></label>
        <label className={styles.wide}>{t('Notas')}<textarea name="notes" rows={3} maxLength={3000} defaultValue={editTx?.notes} /></label>
        {editor.id && <label className={styles.wide}>{t('Motivo del cambio *')}<input name="reason" required maxLength={500} /></label>}
      </div>}
      {editor.type === 'expense' && <div className={styles.fields}>
        <label>{t('Categoría *')}<select name="category" defaultValue={editExpense?.category || EXPENSE_CATEGORIES[0]}>{EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{t(c)}</option>)}</select></label>
        <label>{t('Monto *')}<input name="amount" type="number" step="0.01" min="0" required defaultValue={editExpense?.amount ?? 0} /></label>
        <label>{t('Fecha *')}<input name="date" type="date" required defaultValue={editExpense?.date || today()} /></label>
        <label>{t('Estado *')}<select name="status" defaultValue={editExpense?.status || 'Pendiente'}>{TX_STATUS_VALUES.map(s => <option key={s} value={s}>{t(s)}</option>)}</select></label>
        <label>{t('Chofer')}<select name="driverId" defaultValue={editExpense?.driverId || ''}><option value="">{t('Sin asignar')}</option>{fleet.state.drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>{t('Camión')}<select name="truckId" defaultValue={editExpense?.truckId || ''}><option value="">{t('Sin asignar')}</option>{fleet.state.trucks.map(e => <option key={e.id} value={e.id}>{e.unit}</option>)}</select></label>
        <label>{t('Referencia de carga')}<input name="loadRef" maxLength={100} defaultValue={editExpense?.loadRef} /></label>
        <label>{t('Método de pago')}<input name="paymentMethod" maxLength={100} defaultValue={editExpense?.paymentMethod} /></label>
        <label>{t('Recibo')}<input name="receipt" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" /><small>{editExpense?.receiptFilename ? `${t('Actual:')} ${editExpense.receiptFilename}` : t('PDF o imagen · Hasta 5 MB · Opcional')}</small></label>
        <label className={styles.wide}>{t('Notas')}<textarea name="notes" rows={3} maxLength={3000} defaultValue={editExpense?.notes} /></label>
        {editor.id && <label className={styles.wide}>{t('Motivo del cambio *')}<input name="reason" required maxLength={500} /></label>}
      </div>}
      {editor.type === 'status' && <><p>{t('El registro queda visualmente marcado como final; esto no lo aprueba contablemente.')}</p><label>{t('Nuevo estado')}<select name="status" defaultValue="Final">{TX_STATUS_VALUES.map(s => <option key={s} value={s}>{t(s)}</option>)}</select></label><label>{t('Motivo *')}<input name="reason" required maxLength={500} /></label></>}
      {editor.type === 'delete' && <><p>{t('Esta acción elimina el registro por completo. El evento de auditoría queda guardado igual.')}</p><label>{t('Motivo de la eliminación *')}<input name="reason" required maxLength={500} /></label></>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Guardando…') : t('Guardar')}</button><button type="button" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>{t('Cancelar')}</button></div>
    </form>}

    <div className={styles.filters}>
      <label>{t('Buscar')}<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={tab === 'transacciones' ? t('Estación, chofer, camión o referencia') : t('Categoría, chofer, camión o método')} /></label>
      <label>{t('Filtrar estado')}<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>{['Todos', ...TX_STATUS_VALUES].map(s => <option key={s} value={s}>{t(s)}</option>)}</select></label>
    </div>

    {tab === 'transacciones' ? <div className={styles.cards}>{filteredTx.map(t2 => <article className={styles.card} key={t2.id}>
      <span className={styles.badge}>{t(t2.status)}</span>
      <strong>{t2.station || t('Estación sin indicar')}</strong>
      <span>{dateTime(t2.date)} · {t2.city}{t2.city && t2.state ? ', ' : ''}{t2.state}</span>
      <span>{t2.driverId ? driverName(t2.driverId) : t('Sin chofer')} · {t2.truckId ? truckUnit(t2.truckId) : t('Sin camión')}</span>
      <p><b>{t('Fuel:')}</b> {money(t2.fuelAmount)} · <b>{t('Non-Fuel:')}</b> {money(t2.nonFuelAmount)} · <b>{t('Total:')}</b> {money(txTotal(t2))}</p>
      {t2.externalRef && <span>{t('Ref:')} {t2.externalRef}</span>}
      <div className={styles.actions}>
        <button onClick={() => open('transaction', 'transaction', t2.id)}>{t('Editar')}</button>
        {t2.status === 'Pendiente' && <button onClick={() => open('status', 'transaction', t2.id)}>{t('Marcar final')}</button>}
        <button onClick={() => { if (window.confirm(t('¿Eliminar este registro por completo? No se puede deshacer.'))) open('delete', 'transaction', t2.id); }}>{t('Eliminar')}</button>
      </div>
    </article>)}</div> : <div className={styles.cards}>{filteredExpenses.map(e => <article className={styles.card} key={e.id}>
      <span className={styles.badge}>{t(e.status)}</span>
      <strong>{t(e.category)}</strong>
      <span>{dateTime(e.date)} · {money(e.amount)}</span>
      <span>{e.driverId ? driverName(e.driverId) : t('Sin chofer')} · {e.truckId ? truckUnit(e.truckId) : t('Sin camión')}</span>
      {e.paymentMethod && <span>{t('Pago:')} {e.paymentMethod}</span>}
      {e.receiptFilename && <p>{t('Recibo:')} {e.receiptFilename}</p>}
      <div className={styles.actions}>
        <button onClick={() => open('expense', 'expense', e.id)}>{t('Editar')}</button>
        {e.receiptFilename && <button onClick={() => void downloadReceipt(e)}>{t('Descargar recibo')}</button>}
        {e.status === 'Pendiente' && <button onClick={() => open('status', 'expense', e.id)}>{t('Marcar final')}</button>}
        <button onClick={() => { if (window.confirm(t('¿Eliminar este registro por completo? No se puede deshacer.'))) open('delete', 'expense', e.id); }}>{t('Eliminar')}</button>
      </div>
    </article>)}</div>}
    {ready && (tab === 'transacciones' ? !filteredTx.length : !filteredExpenses.length) && <p className={styles.empty}>{query || statusFilter !== 'Todos' ? t('No hay resultados con estos filtros.') : t('Todavía no hay registros. Usa el botón de arriba para comenzar.')}</p>}

    <section className={styles.profile}><div className={styles.toolbar}><h2>{t('Historial de cambios')}</h2></div>{state.events.length ? <ul>{state.events.slice(0, 15).map(ev => <li key={ev.id}>{dateTime(ev.at)} — {ev.detail}</li>)}</ul> : <p className={styles.empty}>{t('Todavía no hay actividad.')}</p>}</section>
  </div>;
}
