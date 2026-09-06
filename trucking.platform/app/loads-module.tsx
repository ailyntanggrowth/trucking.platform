"use client";
import { useState, type FormEvent } from 'react';
import { LOAD_STATUS_VALUES, PAYMENT_STATUS_VALUES, isOfficial, isActive, balance, routeLabel, type Load, type LoadAction, type LoadStatus, type PaymentStatus } from '../lib/loads';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import { money, dateLabel as dateTime, dayLabel, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import styles from './loads.module.css';

type Tab = 'revision' | 'activas' | 'todas';
type Editor = { type: 'load' | 'approve' | 'reject' | 'cancel' | 'replace'; id: string; revision: number };

export default function LoadsModule({ loads, fleet, lang, t }: { loads: LoadsController; fleet: FleetController; lang: Lang; t: (es: string) => string }) {
  const { state, ready } = loads;
  const [tab, setTab] = useState<Tab>('revision'), [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const driverName = (id: string) => fleet.state.drivers.find(d => d.id === id)?.name || '';
  const truckUnit = (id: string) => fleet.state.trucks.find(e => e.id === id)?.unit || '';

  const review = state.loads.filter(l => l.approval === 'Pendiente');
  const official = state.loads.filter(isOfficial);
  const active = official.filter(isActive);
  const visible = tab === 'revision' ? review : tab === 'activas' ? active : state.loads;
  const filtered = visible.filter(l => `${l.loadNumber} ${l.broker} ${driverName(l.driverId)} ${truckUnit(l.truckId)} ${l.pickupCity} ${l.deliveryCity}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.pickupDate.localeCompare(a.pickupDate));

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
          driverId: text('driverId'), truckId: text('truckId'), trailerId: text('trailerId'),
          pickupCity: text('pickupCity'), pickupState: text('pickupState'), pickupDate: text('pickupDate'),
          deliveryCity: text('deliveryCity'), deliveryState: text('deliveryState'), deliveryDate: text('deliveryDate'),
          amount: num('amount'), status: text('status') as LoadStatus, missingPod: text('missingPod') === 'true',
          paymentStatus: text('paymentStatus') as PaymentStatus, amountReceived: num('amountReceived'), notes: text('notes'),
          approval: 'Pendiente', approvedBy: '', approvedAt: '', rejectedReason: '', cancelReason: '', cancelledAt: '', cancelledBy: '', replacesId: '', replacedBy: '',
        };
        action = editor.type === 'load' ? { type: 'load', record, reason: text('reason') } : { type: 'replace', id: editor.id, replacement: record, reason: text('reason') };
      } else if (editor.type === 'approve') action = { type: 'approve', id: editor.id, reason: text('reason') };
      else if (editor.type === 'reject') action = { type: 'reject', id: editor.id, reason: text('reason') };
      else action = { type: 'cancel', id: editor.id, reason: text('reason') };
      const next = await loads.commit(action, editor.revision);
      setEditor(null); setNotice(next.events[0].detail);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const changeTab = (next: Tab) => { setTab(next); setEditor(null); setQuery(''); setError(''); setNotice(''); };
  const editorTitle = editor?.type === 'load' ? `${editor.id ? t('Editar') : t('Agregar')} ${t('carga')}` : editor?.type === 'approve' ? t('Aprobar carga') : editor?.type === 'reject' ? t('Rechazar carga') : editor?.type === 'cancel' ? t('Cancelar carga') : t('Reemplazar carga');
  const statusBadgeClass = (l: Load) => l.approval === 'Pendiente' ? styles.badgeReview : l.approval === 'Rechazada' ? styles.badgeRejected : l.status === 'Cancelada' ? styles.badgeCancelled : styles.badgeApproved;

  return <div className={styles.loads}>
    <div className={styles.localNotice}><strong>M&A KING</strong><p>{t('Ninguna carga es oficial ni cuenta como ingreso hasta que la apruebes. Las canceladas nunca se borran: quedan en el historial con el motivo.')}</p></div>
    {loads.error && <div role="alert" className={styles.error}>{loads.error} <button onClick={() => void loads.refresh()}>{t('Reintentar')}</button></div>}
    {!ready && !loads.error && <p role="status">{t('Abriendo los registros de cargas…')}</p>}

    <button className={styles.reviewBanner} onClick={() => changeTab('revision')}><div><span>{t('TU APROBACIÓN ES NECESARIA')}</span><h3>{t('Cargas por revisar')}</h3></div><div className={styles.reviewNumber}>{ready ? review.length : '—'}</div></button>

    <div className={styles.metrics}>
      <div><span>{t('Por revisar')}</span><strong>{ready ? review.length : '—'}</strong></div>
      <div><span>{t('Activas')}</span><strong>{ready ? active.length : '—'}</strong></div>
      <div><span>{t('Total registradas')}</span><strong>{ready ? state.loads.length : '—'}</strong></div>
    </div>

    <nav className={styles.tabs} aria-label={t('Secciones de cargas')}>
      <button aria-pressed={tab === 'revision'} onClick={() => changeTab('revision')}>{t('Por revisar')} <span>{review.length}</span></button>
      <button aria-pressed={tab === 'activas'} onClick={() => changeTab('activas')}>{t('Activas')} <span>{active.length}</span></button>
      <button aria-pressed={tab === 'todas'} onClick={() => changeTab('todas')}>{t('Todas')} <span>{state.loads.length}</span></button>
    </nav>
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    <div className={styles.toolbar}><h2>{t('Cargas')}</h2><button className={styles.primary} disabled={!ready || busy} onClick={() => open('load')}>{t('+ Registrar carga')}</button></div>

    {editor && <form id="loads-editor" className={styles.form} onSubmit={submit} key={`${editor.type}-${editor.id}`}>
      <h3>{editorTitle}</h3>
      {(editor.type === 'load' || editor.type === 'replace') && <div className={styles.fields}>
        <label>{t('Número de carga')}<input name="loadNumber" maxLength={100} defaultValue={editor.type === 'load' ? editLoad?.loadNumber : ''} /></label>
        <label>{t('Broker / Cliente')}<input name="broker" maxLength={150} defaultValue={editor.type === 'load' ? editLoad?.broker : target?.broker} /></label>
        <label>{t('Chofer')}<select name="driverId" defaultValue={editor.type === 'load' ? editLoad?.driverId || '' : target?.driverId || ''}><option value="">{t('Sin asignar')}</option>{fleet.state.drivers.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>{t('Camión')}<select name="truckId" defaultValue={editor.type === 'load' ? editLoad?.truckId || '' : target?.truckId || ''}><option value="">{t('Sin asignar')}</option>{fleet.state.trucks.map(e => <option key={e.id} value={e.id}>{e.unit}</option>)}</select></label>
        <label>{t('Trailer')}<select name="trailerId" defaultValue={editor.type === 'load' ? editLoad?.trailerId || '' : target?.trailerId || ''}><option value="">{t('Sin trailer')}</option>{fleet.state.trailers.map(e => <option key={e.id} value={e.id}>{e.unit}</option>)}</select></label>
        <label>{t('Ciudad de recogida')}<input name="pickupCity" maxLength={100} defaultValue={editor.type === 'load' ? editLoad?.pickupCity : ''} /></label>
        <label>{t('Estado de recogida')}<input name="pickupState" maxLength={50} defaultValue={editor.type === 'load' ? editLoad?.pickupState : ''} /></label>
        <label>{t('Fecha de recogida *')}<input name="pickupDate" type="date" required defaultValue={editor.type === 'load' ? (editLoad?.pickupDate || today()) : today()} /></label>
        <label>{t('Ciudad de entrega')}<input name="deliveryCity" maxLength={100} defaultValue={editor.type === 'load' ? editLoad?.deliveryCity : ''} /></label>
        <label>{t('Estado de entrega')}<input name="deliveryState" maxLength={50} defaultValue={editor.type === 'load' ? editLoad?.deliveryState : ''} /></label>
        <label>{t('Fecha de entrega')}<input name="deliveryDate" type="date" defaultValue={editor.type === 'load' ? editLoad?.deliveryDate : ''} /></label>
        <label>{t('Tarifa (monto bruto)')}<input name="amount" type="number" step="0.01" min="0" defaultValue={editor.type === 'load' ? editLoad?.amount ?? 0 : 0} /></label>
        <label>{t('Estado operativo')}<select name="status" defaultValue={editor.type === 'load' ? editLoad?.status || 'Programado' : 'Programado'}>{LOAD_STATUS_VALUES.filter(s => s !== 'Cancelada' && s !== 'Reemplazada').map(s => <option key={s} value={s}>{t(s)}</option>)}</select></label>
        <label>{t('Falta POD')}<select name="missingPod" defaultValue={editor.type === 'load' ? String(editLoad?.missingPod ?? false) : 'false'}><option value="false">{t('No')}</option><option value="true">{t('Sí')}</option></select></label>
        <label>{t('Estado de pago')}<select name="paymentStatus" defaultValue={editor.type === 'load' ? editLoad?.paymentStatus || 'Pendiente' : 'Pendiente'}>{PAYMENT_STATUS_VALUES.map(s => <option key={s} value={s}>{t(s)}</option>)}</select></label>
        <label>{t('Monto recibido')}<input name="amountReceived" type="number" step="0.01" min="0" defaultValue={editor.type === 'load' ? editLoad?.amountReceived ?? 0 : 0} /></label>
        <label className={styles.wide}>{t('Notas')}<textarea name="notes" rows={3} maxLength={3000} defaultValue={editor.type === 'load' ? editLoad?.notes : ''} /></label>
        {(editor.type === 'replace' || editor.id) && <label className={styles.wide}>{t('Motivo del cambio *')}<input name="reason" required maxLength={500} /></label>}
      </div>}
      {editor.type === 'approve' && <><p>{t('Al aprobar, esta carga pasa a contar como oficial y activa.')}</p><label>{t('Motivo de la aprobación *')}<input name="reason" required maxLength={500} /></label></>}
      {editor.type === 'reject' && <><p>{t('La carga queda en el historial marcada como rechazada — nunca cuenta como ingreso.')}</p><label>{t('Motivo del rechazo *')}<input name="reason" required maxLength={500} /></label></>}
      {editor.type === 'cancel' && <><p>{t('La carga no se borra: queda cancelada en el historial con el motivo.')}</p><label>{t('Motivo de la cancelación *')}<input name="reason" required maxLength={500} /></label></>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Guardando…') : t('Guardar')}</button><button type="button" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>{t('Cancelar')}</button></div>
    </form>}

    <div className={styles.filters}>
      <label>{t('Buscar')}<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Número, broker, chofer, camión o ciudad')} /></label>
    </div>

    <div className={styles.cards}>{filtered.map(l => <article className={styles.card} key={l.id}>
      <div className={styles.badgeRow}>
        <span className={`${styles.badge} ${statusBadgeClass(l)}`}>{l.approval === 'Pendiente' ? t('Por revisar') : l.approval === 'Rechazada' ? t('Rechazada') : t(l.status)}</span>
        {l.missingPod && <span className={styles.badge}>{t('Falta POD')}</span>}
      </div>
      <strong>{l.loadNumber || t('Sin número')} {l.broker && `· ${l.broker}`}</strong>
      <span>{routeLabel(l)}</span>
      <span>{t('Recogida:')} {dayLabel(l.pickupDate)}{l.deliveryDate && ` · ${t('Entrega:')} ${dayLabel(l.deliveryDate)}`}</span>
      <span>{l.driverId ? driverName(l.driverId) : t('Sin chofer')} · {l.truckId ? truckUnit(l.truckId) : t('Sin camión')}</span>
      <p><b>{t('Tarifa:')}</b> {money(l.amount)} · <b>{t('Pago:')}</b> {t(l.paymentStatus)} {l.amountReceived > 0 && `(${money(l.amountReceived)} ${t('recibido')})`}</p>
      {l.replacedBy && <span>{t('Reemplazada por:')} {state.loads.find(x => x.id === l.replacedBy)?.loadNumber || l.replacedBy}</span>}
      {l.replacesId && <span>{t('Reemplaza a:')} {state.loads.find(x => x.id === l.replacesId)?.loadNumber || l.replacesId}</span>}
      {l.approval === 'Rechazada' && l.rejectedReason && <p className={styles.empty}>{t('Motivo del rechazo:')} {l.rejectedReason}</p>}
      {l.status === 'Cancelada' && l.cancelReason && <p className={styles.empty}>{t('Motivo de cancelación:')} {l.cancelReason}</p>}
      <div className={styles.actions}>
        {l.approval === 'Pendiente' && <button onClick={() => open('approve', l.id)}>{t('Aprobar')}</button>}
        {l.approval === 'Pendiente' && <button onClick={() => open('reject', l.id)}>{t('Rechazar')}</button>}
        <button onClick={() => open('load', l.id)}>{t('Editar')}</button>
        {l.status !== 'Cancelada' && l.status !== 'Reemplazada' && <button onClick={() => open('cancel', l.id)}>{t('Cancelar')}</button>}
        {l.status === 'Cancelada' && !l.replacedBy && <button onClick={() => open('replace', l.id)}>{t('Reemplazar')}</button>}
      </div>
    </article>)}</div>
    {ready && !filtered.length && <p className={styles.empty}>{query ? t('No hay resultados con estos filtros.') : t('Todavía no hay cargas en esta vista. Usa el botón de arriba para comenzar.')}</p>}

    <section className={styles.profile}><div className={styles.toolbar}><h2>{t('Historial de cambios')}</h2></div>{state.events.length ? <ul>{state.events.slice(0, 15).map(ev => <li key={ev.id}>{dateTime(ev.at)} — {ev.detail}</li>)}</ul> : <p className={styles.empty}>{t('Todavía no hay actividad.')}</p>}</section>
  </div>;
}
