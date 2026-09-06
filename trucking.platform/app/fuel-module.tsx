"use client";
import { useState, type FormEvent } from 'react';
import { EXPENSE_CATEGORIES, summarizeFuel, txTotal, type Expense, type ExpenseCategory, type FuelAction, type FuelTransaction } from '../lib/fuel';
import type { FuelController } from '../lib/use-fuel';
import { getExpenseReceiptUrl, parseMudflapStatementAction, commitStatementImportAction, type MudflapParsePreview } from '../lib/fuel-actions';
import type { FleetController } from '../lib/use-fleet';
import { money, dateLabel as dateTime, dayLabel, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { Fuel as FuelIcon, Receipt, Wallet } from 'lucide-react';
import styles from './fuel.module.css';

type Tab = 'transacciones' | 'gastos';
type Editor = { type: 'transaction' | 'expense' | 'delete'; kind: 'transaction' | 'expense'; id: string; revision: number };
const monthStart = () => today().slice(0, 7) + '-01';
const monthEnd = () => { const d = new Date(`${monthStart()}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };
async function downloadReceipt(expense: Expense) { const url = await getExpenseReceiptUrl(expense.id); const a = document.createElement('a'); a.href = url; a.download = expense.receiptFilename || 'recibo'; a.click(); }

export default function FuelModule({ fuel, fleet, lang, t }: { fuel: FuelController; fleet: FleetController; lang: Lang; t: (es: string) => string }) {
  const { state, ready } = fuel;
  const [tab, setTab] = useState<Tab>('transacciones'), [query, setQuery] = useState('');
  const [start, setStart] = useState(monthStart()), [end, setEnd] = useState(monthEnd());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false), [importBusy, setImportBusy] = useState(false), [importError, setImportError] = useState('');
  const [preview, setPreview] = useState<MudflapParsePreview | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [rowDriverOverride, setRowDriverOverride] = useState<Record<number, string>>({});
  const [page, setPage] = useState(1); const pageSize = 5;
  const driverName = (id: string) => fleet.state.drivers.find(d => d.id === id)?.name || '';
  const truckUnit = (id: string) => fleet.state.trucks.find(e => e.id === id)?.unit || '';
  const summary = summarizeFuel(state, start, end);
  // No se permite importar hasta que no queden filas sin leer y los totales
  // calculados coincidan al centavo con lo que el propio PDF declara — es la
  // única forma de estar seguros de que ninguna transacción quedó afuera.
  const reconciled = Boolean(preview) && preview!.unparsed.length === 0
    && (preview!.declared.fuel === null || Math.abs(preview!.declared.fuel - preview!.totals.fuel) < 0.01)
    && (preview!.declared.nonFuel === null || Math.abs(preview!.declared.nonFuel - preview!.totals.nonFuel) < 0.01);

  function openImport() { setError(''); setNotice(''); setEditor(null); setImportError(''); setPreview(null); setImportOpen(true); requestAnimationFrame(() => document.getElementById('fuel-import')?.scrollIntoView({ block: 'start', behavior: 'instant' })); }
  async function handleParseStatement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (importBusy) return; const fields = new FormData(event.currentTarget);
    setImportBusy(true); setImportError('');
    try {
      const result = await parseMudflapStatementAction(fields);
      setPreview(result);
      setSelectedRows(new Set(result.rows.map((r, i) => i).filter(i => !result.rows[i].duplicate)));
      setRowDriverOverride({});
    } catch (e) { setImportError((e as Error).message); } finally { setImportBusy(false); }
  }
  async function confirmImport() {
    if (!preview || importBusy) return;
    setImportBusy(true); setImportError('');
    try {
      const input = preview.rows.map((r, i) => ({ r, i })).filter(({ i }) => selectedRows.has(i)).map(({ r, i }) => ({
        date: r.date, type: r.type, station: r.station, city: r.city, state: r.state,
        driverId: rowDriverOverride[i] ?? r.driverId, amount: r.amount, externalRef: r.externalRef,
        notes: `Importado de statement Mudflap${!(rowDriverOverride[i] ?? r.driverId) && r.driverNameRaw ? ` · Chofer en statement: ${r.driverNameRaw}` : ''}`,
      }));
      const result = await commitStatementImportAction(input, state.revision);
      await fuel.refresh();
      setImportOpen(false); setPreview(null); setSelectedRows(new Set());
      setNotice(`${t('¡Listo!')} ${result.imported} ${t('transacciones importadas correctamente.')}${result.skippedDuplicates ? ` ${result.skippedDuplicates} ${t('se omitieron por ya existir en la base de datos.')}` : ''}`);
    } catch (e) { setImportError((e as Error).message); } finally { setImportBusy(false); }
  }
  function toggleRow(i: number) { setSelectedRows(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; }); }

  function open(type: Editor['type'], kind: Editor['kind'], id = '') { setError(''); setNotice(''); setImportOpen(false); setEditor({ type, kind, id, revision: state.revision }); requestAnimationFrame(() => document.getElementById('fuel-editor')?.scrollIntoView({ block: 'start', behavior: 'instant' })); }
  const editTx = editor?.type === 'transaction' ? state.transactions.find(x => x.id === editor.id) : undefined;
  const editExpense = editor?.type === 'expense' ? state.expenses.find(x => x.id === editor.id) : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor || busy) return; const fields = new FormData(event.currentTarget); const text = (key: string) => String(fields.get(key) || '').trim(); const num = (key: string) => Number(fields.get(key) || 0);
    setError(''); setBusy(true);
    try {
      let action: FuelAction;
      if (editor.type === 'transaction') {
        const record: FuelTransaction = { id: editor.id || crypto.randomUUID(), date: text('date'), driverId: text('driverId'), truckId: text('truckId'), loadRef: text('loadRef'), station: text('station'), city: text('city'), state: text('state'), gallons: num('gallons'), pricePerGallon: num('pricePerGallon'), fuelAmount: num('fuelAmount'), nonFuelAmount: num('nonFuelAmount'), status: 'Final', externalRef: text('externalRef'), notes: text('notes') };
        action = { type: 'transaction', record, reason: text('reason') };
      } else if (editor.type === 'expense') {
        const file = fields.get('receipt') as File;
        const record: Expense = { id: editor.id || crypto.randomUUID(), category: text('category') as ExpenseCategory, amount: num('amount'), date: text('date'), driverId: text('driverId'), truckId: text('truckId'), loadRef: text('loadRef'), paymentMethod: text('paymentMethod'), notes: text('notes'), status: 'Final', receiptFilename: editExpense?.receiptFilename };
        action = { type: 'expense', record, receiptFile: file && file.size > 0 ? file : undefined, reason: text('reason') };
      } else {
        action = { type: 'delete', kind: editor.kind, id: editor.id, reason: text('reason') };
      }
      const next = await fuel.commit(action, editor.revision);
      setEditor(null); setNotice(next.events[0].detail);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const changeTab = (next: Tab) => { setTab(next); setEditor(null); setImportOpen(false); setQuery(''); setError(''); setNotice(''); setPage(1); };
  const filteredTx = state.transactions.filter(t2 => `${t2.station} ${t2.city} ${t2.state} ${driverName(t2.driverId)} ${truckUnit(t2.truckId)} ${t2.externalRef}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.date.localeCompare(a.date));
  const filteredExpenses = state.expenses.filter(e => `${e.category} ${driverName(e.driverId)} ${truckUnit(e.truckId)} ${e.paymentMethod}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.date.localeCompare(a.date));
  const rows = tab === 'transacciones' ? filteredTx : filteredExpenses;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const pageTx = filteredTx.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const pageExpenses = filteredExpenses.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const editorTitle = editor?.type === 'transaction' ? `${editor.id ? t('Editar') : t('Agregar')} ${t('transacción de combustible')}` : editor?.type === 'expense' ? `${editor.id ? t('Editar') : t('Agregar')} ${t('gasto')}` : t('Eliminar registro');

  return <div className={styles.fuel}>
    <div className={styles.localNotice}><strong>M&A KING</strong><p>{t('Los datos y recibos se guardan en Supabase y se sincronizan entre dispositivos. Los totales aquí no son ganancia final: faltan deducciones de Contabilidad.')}</p></div>
    {fuel.error && <div role="alert" className={styles.error}>{fuel.error} <button onClick={() => void fuel.refresh()}>{t('Reintentar')}</button></div>}
    {!ready && !fuel.error && <p role="status">{t('Abriendo los registros de combustible y gastos…')}</p>}
    <div className={styles.filters}>
      <label>{t('Desde')}<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label>{t('Hasta')}<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
    </div>
    <div className={styles.statCards}>
      <div className={styles.statCard} data-tone="blue"><span className={styles.statIcon} aria-hidden="true"><FuelIcon size={16}/></span><span className={styles.statLabel}>{t('Fuel')}</span><strong>{ready ? money(summary.fuel) : '—'}</strong></div>
      <div className={styles.statCard} data-tone="amber"><span className={styles.statIcon} aria-hidden="true"><Receipt size={16}/></span><span className={styles.statLabel}>{t('Non-Fuel')}</span><strong>{ready ? money(summary.nonFuel) : '—'}</strong></div>
      <div className={styles.statCard} data-tone="red"><span className={styles.statIcon} aria-hidden="true"><Wallet size={16}/></span><span className={styles.statLabel}>{t('Otros gastos')}</span><strong>{ready ? money(summary.expenseTotal) : '—'}</strong></div>
    </div>
    <nav className={styles.tabs} aria-label={t('Secciones de combustible')}>
      <button aria-pressed={tab === 'transacciones'} onClick={() => changeTab('transacciones')}>{t('Combustible')} <span>{state.transactions.length}</span></button>
      <button aria-pressed={tab === 'gastos'} onClick={() => changeTab('gastos')}>{t('Gastos')} <span>{state.expenses.length}</span></button>
    </nav>
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    <div className={styles.toolbar}><h2>{tab === 'transacciones' ? t('Transacciones de combustible') : t('Gastos operativos')}</h2><div className={styles.actions}>{tab === 'transacciones' && <button disabled={!ready || busy} onClick={openImport}>{t('Importar statement (PDF)')}</button>}<button className={styles.primary} disabled={!ready || busy} onClick={() => open(tab === 'transacciones' ? 'transaction' : 'expense', tab === 'transacciones' ? 'transaction' : 'expense')}>{tab === 'transacciones' ? t('+ Registrar transacción') : t('+ Registrar gasto')}</button></div></div>

    {importOpen && <div id="fuel-import" className={styles.form}>
      <h3>{t('Importar statement de Mudflap')}</h3>
      <p>{t('Sube el PDF semanal. Se leen las filas exactas del documento (sin adivinar montos); tú revisas y confirmas antes de guardar nada.')}</p>
      <form onSubmit={handleParseStatement} className={styles.fields}>
        <label className={styles.wide}>{t('Archivo PDF *')}<input name="statement" type="file" accept="application/pdf" required disabled={importBusy} /></label>
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={importBusy}>{importBusy ? t('Leyendo…') : t('Analizar PDF')}</button><button type="button" disabled={importBusy} onClick={() => { setImportOpen(false); setPreview(null); setImportError(''); }}>{t('Cancelar')}</button></div>
      </form>
      {importError && <p className={styles.error} role="alert">{importError}</p>}
      {preview && <>
        {preview.period && <p>{t('Período del statement:')} {dayLabel(preview.period.start)} – {dayLabel(preview.period.end)}</p>}
        <p>
          <b>{t('Filas leídas:')}</b> {preview.rows.length} · <b>{t('Fuel:')}</b> {money(preview.totals.fuel)}{preview.declared.fuel !== null && (Math.abs(preview.declared.fuel - preview.totals.fuel) < 0.01 ? ` ✓ ${t('coincide con el PDF')}` : ` ⚠ ${t('el PDF declara')} ${money(preview.declared.fuel)}`)}
          {' · '}<b>{t('Non-Fuel:')}</b> {money(preview.totals.nonFuel)}{preview.declared.nonFuel !== null && (Math.abs(preview.declared.nonFuel - preview.totals.nonFuel) < 0.01 ? ` ✓ ${t('coincide con el PDF')}` : ` ⚠ ${t('el PDF declara')} ${money(preview.declared.nonFuel)}`)}
        </p>
        {preview.unparsed.length > 0 && <p className={styles.error} role="alert">{preview.unparsed.length} {t('fila(s) no se pudieron leer automáticamente (posible salto de página en el PDF) — agrégalas manualmente:')} {preview.unparsed.map((u, i) => <details key={i}><summary>{t('Ver texto sin procesar')}</summary><pre>{u.raw}</pre></details>)}</p>}
        {!reconciled && <p className={styles.error} role="alert">{t('No se puede importar todavía: los totales no coinciden exactamente con lo que declara el PDF, o hay filas sin leer. Resuelve eso primero.')}</p>}
        <div className={styles.importTableWrap}>
          <table className={styles.importTable}>
            <thead><tr><th></th><th>{t('Fecha')}</th><th>{t('Tipo')}</th><th>{t('Estación')}</th><th>{t('Ciudad')}</th><th>{t('Chofer')}</th><th>{t('Monto')}</th></tr></thead>
            <tbody>{preview.rows.map((r, i) => <tr key={i} className={r.duplicate ? styles.duplicateRow : ''}>
              <td><input type="checkbox" checked={selectedRows.has(i)} onChange={() => toggleRow(i)} aria-label={t('Incluir fila')} /></td>
              <td>{dayLabel(r.date)}</td>
              <td>{t(r.type)}</td>
              <td>{r.station}</td>
              <td>{r.city}{r.city && r.state ? ', ' : ''}{r.state}</td>
              <td><select value={rowDriverOverride[i] ?? r.driverId} onChange={e => setRowDriverOverride(prev => ({ ...prev, [i]: e.target.value }))}><option value="">{r.driverNameRaw ? `${t('Sin asignar')} (${r.driverNameRaw})` : t('Sin asignar')}</option>{fleet.state.drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></td>
              <td>{money(r.amount)}{r.duplicate ? ` · ${t('posible duplicado')}` : ''}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className={styles.actions}><button className={styles.primary} disabled={importBusy || !selectedRows.size || !reconciled} onClick={confirmImport}>{importBusy ? t('Importando…') : `${t('Confirmar e importar')} (${selectedRows.size})`}</button><button type="button" disabled={importBusy} onClick={() => { setImportOpen(false); setPreview(null); }}>{t('Cancelar')}</button></div>
      </>}
    </div>}

    {editor && <form id="fuel-editor" className={styles.form} onSubmit={submit} key={`${editor.type}-${editor.id}`}>
      <h3>{editorTitle}</h3>
      {editor.type === 'transaction' && <div className={styles.fields}>
        <label>{t('Fecha de la visita *')}<input name="date" type="date" required defaultValue={editTx?.date || today()} /></label>
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
        <label>{t('Chofer')}<select name="driverId" defaultValue={editExpense?.driverId || ''}><option value="">{t('Sin asignar')}</option>{fleet.state.drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>{t('Camión')}<select name="truckId" defaultValue={editExpense?.truckId || ''}><option value="">{t('Sin asignar')}</option>{fleet.state.trucks.map(e => <option key={e.id} value={e.id}>{e.unit}</option>)}</select></label>
        <label>{t('Referencia de carga')}<input name="loadRef" maxLength={100} defaultValue={editExpense?.loadRef} /></label>
        <label>{t('Método de pago')}<input name="paymentMethod" maxLength={100} defaultValue={editExpense?.paymentMethod} /></label>
        <label>{t('Recibo')}<input name="receipt" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" /><small>{editExpense?.receiptFilename ? `${t('Actual:')} ${editExpense.receiptFilename}` : t('PDF o imagen · Hasta 5 MB · Opcional')}</small></label>
        <label className={styles.wide}>{t('Notas')}<textarea name="notes" rows={3} maxLength={3000} defaultValue={editExpense?.notes} /></label>
        {editor.id && <label className={styles.wide}>{t('Motivo del cambio *')}<input name="reason" required maxLength={500} /></label>}
      </div>}
      {editor.type === 'delete' && <><p>{t('Esta acción elimina el registro por completo. El evento de auditoría queda guardado igual.')}</p><label>{t('Motivo de la eliminación *')}<input name="reason" required maxLength={500} /></label></>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Guardando…') : t('Guardar')}</button><button type="button" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>{t('Cancelar')}</button></div>
    </form>}

    <div className={styles.filters}>
      <label>{t('Buscar')}<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={tab === 'transacciones' ? t('Estación, chofer, camión o referencia') : t('Categoría, chofer, camión o método')} /></label>
    </div>

    {tab === 'transacciones' ? <div className={styles.cards}>{pageTx.map(t2 => <article className={styles.card} key={t2.id}>
      <strong>{t2.station || t('Estación sin indicar')}</strong>
      <span>{dayLabel(t2.date)} · {t2.city}{t2.city && t2.state ? ', ' : ''}{t2.state}</span>
      <span>{t2.driverId ? driverName(t2.driverId) : t('Sin chofer')} · {t2.truckId ? truckUnit(t2.truckId) : t('Sin camión')}</span>
      <p><b>{t('Fuel:')}</b> {money(t2.fuelAmount)} · <b>{t('Non-Fuel:')}</b> {money(t2.nonFuelAmount)} · <b>{t('Total:')}</b> {money(txTotal(t2))}</p>
      {t2.externalRef && <span>{t('Ref:')} {t2.externalRef}</span>}
      <div className={styles.actions}>
        <button onClick={() => open('transaction', 'transaction', t2.id)}>{t('Editar')}</button>
        <button onClick={() => { if (window.confirm(t('¿Eliminar este registro por completo? No se puede deshacer.'))) open('delete', 'transaction', t2.id); }}>{t('Eliminar')}</button>
      </div>
    </article>)}</div> : <div className={styles.cards}>{pageExpenses.map(e => <article className={styles.card} key={e.id}>
      <strong>{t(e.category)}</strong>
      <span>{dayLabel(e.date)} · {money(e.amount)}</span>
      <span>{e.driverId ? driverName(e.driverId) : t('Sin chofer')} · {e.truckId ? truckUnit(e.truckId) : t('Sin camión')}</span>
      {e.paymentMethod && <span>{t('Pago:')} {e.paymentMethod}</span>}
      {e.receiptFilename && <p>{t('Recibo:')} {e.receiptFilename}</p>}
      <div className={styles.actions}>
        <button onClick={() => open('expense', 'expense', e.id)}>{t('Editar')}</button>
        {e.receiptFilename && <button onClick={() => void downloadReceipt(e)}>{t('Descargar recibo')}</button>}
        <button onClick={() => { if (window.confirm(t('¿Eliminar este registro por completo? No se puede deshacer.'))) open('delete', 'expense', e.id); }}>{t('Eliminar')}</button>
      </div>
    </article>)}</div>}
    {ready && !rows.length && <p className={styles.empty}>{query ? t('No hay resultados con estos filtros.') : t('Todavía no hay registros. Usa el botón de arriba para comenzar.')}</p>}
    {rows.length > 0 && <div className={styles.pagination}>
      <span>{t('Mostrando')} {(pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, rows.length)} {t('de')} {rows.length}</span>
      <div className={styles.pageButtons}>
        <button disabled={pageSafe <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} aria-label={t('Anterior')}>‹</button>
        {Array.from({ length: pageCount }, (_, i) => i + 1).map(n => <button key={n} aria-pressed={pageSafe === n} onClick={() => setPage(n)}>{n}</button>)}
        <button disabled={pageSafe >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))} aria-label={t('Siguiente')}>›</button>
      </div>
    </div>}

    <section className={styles.profile}><div className={styles.toolbar}><h2>{t('Historial de cambios')}</h2></div>{state.events.length ? <ul>{state.events.slice(0, 15).map(ev => <li key={ev.id}>{dateTime(ev.at)} — {ev.detail}</li>)}</ul> : <p className={styles.empty}>{t('Todavía no hay actividad.')}</p>}</section>
  </div>;
}
