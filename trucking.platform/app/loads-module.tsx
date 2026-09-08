"use client";
import { useState, type FormEvent } from 'react';
import { LOAD_STATUS_VALUES, PAYMENT_STATUS_VALUES, type Load, type LoadAction, type LoadStatus, type PaymentStatus } from '../lib/loads';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import { money, dayLabel, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { Search } from 'lucide-react';
import styles from './loads.module.css';

type Editor = { type: 'load' | 'cancel' | 'replace'; id: string; revision: number };
const FLEET_GROUPS = ['Mario', 'Owner Operators', 'Lázaro'] as const;

export default function LoadsModule({ loads, fleet, lang, t, initialFilter }: { loads: LoadsController; fleet: FleetController; lang: Lang; t: (es: string) => string; initialFilter?: string }) {
  const { state, ready } = loads;
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const driverName = (id: string) => fleet.state.drivers.find(d => d.id === id)?.name || '';
  const driverGroup = (id: string) => fleet.state.drivers.find(d => d.id === id)?.group || '';

  // Grupos de la flota (pedido explícito): Mario, Owner Operators y Lázaro —
  // al elegir uno se ve solo sus choferes y sus cargas.
  const groupLoads = groupFilter ? state.loads.filter(l => driverGroup(l.driverId) === groupFilter) : state.loads;
  const searched = groupLoads.filter(l => `${l.loadNumber} ${l.broker} ${driverName(l.driverId)} ${l.pickupState} ${l.deliveryState}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.pickupDate.localeCompare(a.pickupDate));
  // Una sola tabla (pedido explícito: lo anterior con carriles y colores por
  // todos lados no se entendía) — el único filtro visible es el grupo de
  // arriba; el estado del viaje y el cobro son solo columnas con color, no
  // secciones separadas. Las canceladas no se muestran (pedido explícito).
  const visible = searched.filter(l => l.status !== 'Cancelada' && l.status !== 'Reemplazada');
  const statusTone = (s: LoadStatus) => s === 'En tránsito' ? 'blue' : (s === 'Entregada' || s === 'Completada') ? 'green' : 'gray';
  const paymentTone = (p: PaymentStatus) => p === 'Pagada' ? 'green' : p === 'Pendiente' ? 'orange' : p === 'Disputada' ? 'red' : 'gray';

  function open(type: Editor['type'], id = '') { setError(''); setNotice(''); setEditor({ type, id, revision: state.revision }); requestAnimationFrame(() => document.getElementById('loads-editor')?.scrollIntoView({ block: 'start', behavior: 'instant' })); }
  const editLoad = editor?.type === 'load' ? state.loads.find(l => l.id === editor.id) : undefined;
  const target = editor ? state.loads.find(l => l.id === editor.id) : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor || busy) return; const fields = new FormData(event.currentTarget); const text = (key: string) => String(fields.get(key) || '').trim(); const num = (key: string) => Number(fields.get(key) || 0);
    setError(''); setBusy(true);
    try {
      let action: LoadAction;
      if (editor.type === 'load' || editor.type === 'replace') {
        const record: Load = {
          id: editor.type === 'load' ? (editor.id || crypto.randomUUID()) : crypto.randomUUID(),
          loadNumber: text('loadNumber'), broker: text('broker'),
          driverId: text('driverId'), truckId: '', trailerId: '',
          pickupCity: '', pickupState: text('pickupState'), pickupDate: text('pickupDate'),
          deliveryCity: '', deliveryState: text('deliveryState'), deliveryDate: text('deliveryDate'),
          amount: num('amount'), status: text('status') as LoadStatus, missingPod: false,
          paymentStatus: text('paymentStatus') as PaymentStatus, amountReceived: num('amountReceived'), paidAt: '', notes: text('notes'),
          approval: 'Pendiente', approvedBy: '', approvedAt: '', rejectedReason: '', cancelReason: '', cancelledAt: '', cancelledBy: '', replacesId: '', replacedBy: '',
        };
        action = editor.type === 'load' ? { type: 'load', record, reason: text('reason') } : { type: 'replace', id: editor.id, replacement: record, reason: text('reason') };
      } else action = { type: 'cancel', id: editor.id, reason: text('reason') };
      const next = await loads.commit(action, editor.revision);
      setEditor(null); setNotice(next.events[0].detail);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const changeGroup = (next: string | null) => { setGroupFilter(next); setEditor(null); setQuery(''); setError(''); setNotice(''); };
  const dateRange = (l: Load) => `${dayLabel(l.pickupDate)}${l.deliveryDate ? ` → ${dayLabel(l.deliveryDate)}` : ''}`;
  const editorTitle = editor?.type === 'load' ? `${editor.id ? t('Editar') : t('Agregar')} ${t('carga')}` : editor?.type === 'cancel' ? t('Cancelar carga') : t('Reemplazar carga');

  return <div className={styles.loads}>
    {loads.error && <div role="alert" className={styles.error}>{loads.error} <button onClick={() => void loads.refresh()}>{t('Reintentar')}</button></div>}
    {!ready && !loads.error && <p role="status">{t('Abriendo los registros de cargas…')}</p>}

    <nav className={styles.tabs} aria-label={t('Grupos de la flota')}>
      <button aria-pressed={groupFilter === null} onClick={() => changeGroup(null)}>{t('Todos')}</button>
      {FLEET_GROUPS.map(g => <button key={g} aria-pressed={groupFilter === g} onClick={() => changeGroup(g)}>{g}</button>)}
    </nav>

    {notice && <p role="status" className={styles.success}>{notice}</p>}

    <div className={styles.toolbarRow}>
      <label className={styles.searchField}><Search size={17} aria-hidden="true"/><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Buscar chofer, carga o broker...')} /></label>
      <button className={styles.primary} disabled={!ready || busy} onClick={() => open('load')}>{t('+ Registrar carga')}</button>
    </div>

    {editor && <form id="loads-editor" className={styles.form} onSubmit={submit} key={`${editor.type}-${editor.id}`}>
      <h3>{editorTitle}</h3>
      {(editor.type === 'load' || editor.type === 'replace') && <div className={styles.fields}>
        <label>{t('Número de carga')}<input name="loadNumber" maxLength={100} defaultValue={editor.type === 'load' ? editLoad?.loadNumber : ''} /></label>
        <label>{t('Broker / Cliente')}<input name="broker" maxLength={150} defaultValue={editor.type === 'load' ? editLoad?.broker : target?.broker} /></label>
        <label>{t('Chofer')}<select name="driverId" defaultValue={editor.type === 'load' ? editLoad?.driverId || '' : target?.driverId || ''}><option value="">{t('Sin asignar')}</option>{fleet.state.drivers.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>{t('Estado de recogida')}<input name="pickupState" maxLength={50} defaultValue={editor.type === 'load' ? editLoad?.pickupState : ''} /></label>
        <label>{t('Fecha de recogida *')}<input name="pickupDate" type="date" required defaultValue={editor.type === 'load' ? (editLoad?.pickupDate || today()) : today()} /></label>
        <label>{t('Estado de entrega')}<input name="deliveryState" maxLength={50} defaultValue={editor.type === 'load' ? editLoad?.deliveryState : ''} /></label>
        <label>{t('Fecha de entrega')}<input name="deliveryDate" type="date" defaultValue={editor.type === 'load' ? editLoad?.deliveryDate : ''} /></label>
        <label>{t('Tarifa (monto bruto)')}<input name="amount" type="number" step="0.01" min="0" defaultValue={editor.type === 'load' ? editLoad?.amount ?? 0 : 0} /></label>
        <label>{t('Estado operativo')}<select name="status" defaultValue={editor.type === 'load' ? editLoad?.status || 'Programado' : 'Programado'}>{LOAD_STATUS_VALUES.filter(s => s !== 'Cancelada' && s !== 'Reemplazada').map(s => <option key={s} value={s}>{t(s)}</option>)}</select></label>
        <label>{t('Estado de pago')}<select name="paymentStatus" defaultValue={editor.type === 'load' ? editLoad?.paymentStatus || 'Pendiente' : 'Pendiente'}>{PAYMENT_STATUS_VALUES.map(s => <option key={s} value={s}>{t(s)}</option>)}</select></label>
        <label>{t('Monto recibido')}<input name="amountReceived" type="number" step="0.01" min="0" defaultValue={editor.type === 'load' ? editLoad?.amountReceived ?? 0 : 0} /></label>
        <label className={styles.wide}>{t('Notas')}<textarea name="notes" rows={3} maxLength={3000} defaultValue={editor.type === 'load' ? editLoad?.notes : ''} /></label>
        {(editor.type === 'replace' || editor.id) && <label className={styles.wide}>{t('Motivo del cambio *')}<input name="reason" required maxLength={500} /></label>}
      </div>}
      {editor.type === 'cancel' && <><p>{t('La carga no se borra: queda cancelada en el historial con el motivo.')}</p><label>{t('Motivo de la cancelación *')}<input name="reason" required maxLength={500} /></label></>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Guardando…') : t('Guardar')}</button><button type="button" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>{t('Cancelar')}</button></div>
    </form>}

    <div className={styles.tableWrap}>
      <table className={styles.dataTable}>
        <thead><tr><th>{t('Chofer / Carga')}</th><th>{t('Ruta')}</th><th>{t('Pickup / Delivery')}</th><th>{t('Estado del viaje')}</th><th>{t('Cobro')}</th><th aria-hidden="true"></th></tr></thead>
        <tbody>{visible.map(l => <tr key={l.id} className={styles.clickRow} onClick={() => open('load', l.id)}>
          <td>
            <strong>{l.driverId ? driverName(l.driverId) : t('Sin chofer')}</strong>
            <span className={styles.tableSub}>{l.loadNumber || t('Sin número')}{l.broker && ` · ${l.broker}`}</span>
          </td>
          <td className={styles.tableSub} data-label={t('Ruta')}>{l.pickupState || '—'} → {l.deliveryState || '—'}</td>
          <td className={styles.tableSub} data-label={t('Pickup / Delivery')}>{dateRange(l)}</td>
          <td data-label={t('Estado del viaje')}><span className={styles.badge} data-tone={statusTone(l.status)}>{t(l.status)}</span></td>
          <td data-label={t('Cobro')}><span className={styles.badge} data-tone={paymentTone(l.paymentStatus)}>{t(l.paymentStatus)}</span></td>
          <td className={styles.tableActions} onClick={e => e.stopPropagation()}>
            <button onClick={() => open('cancel', l.id)}>{t('Cancelar')}</button>
          </td>
        </tr>)}</tbody>
      </table>
      {ready && !visible.length && <p className={styles.empty}>{query ? t('No hay resultados con estos filtros.') : t('Todavía no hay cargas en esta vista. Usa el botón de arriba para comenzar.')}</p>}
    </div>
    {visible.length > 0 && <p className={styles.note}>{visible.length} {t('cargas en este período')}</p>}
  </div>;
}
