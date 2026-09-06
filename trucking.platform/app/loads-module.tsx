"use client";
import { useState, type FormEvent } from 'react';
import { LOAD_STATUS_VALUES, PAYMENT_STATUS_VALUES, isOfficial, isActive, type Load, type LoadAction, type LoadStatus, type PaymentStatus } from '../lib/loads';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import { money, dateLabel as dateTime, dayLabel, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { AlertTriangle, Clock, Truck, ClipboardList, XCircle, Search, SlidersHorizontal, MoreVertical } from 'lucide-react';
import styles from './loads.module.css';

type Editor = { type: 'load' | 'reject' | 'cancel' | 'replace'; id: string; revision: number };

export default function LoadsModule({ loads, fleet, lang, t, initialFilter }: { loads: LoadsController; fleet: FleetController; lang: Lang; t: (es: string) => string; initialFilter?: string }) {
  const { state, ready } = loads;
  const [filter, setFilter] = useState(initialFilter || 'Por revisar'), [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1); const pageSize = 5;
  const driverName = (id: string) => fleet.state.drivers.find(d => d.id === id)?.name || '';
  const truckUnit = (id: string) => fleet.state.trucks.find(e => e.id === id)?.unit || '';
  const driverGroup = (id: string) => fleet.state.drivers.find(d => d.id === id)?.group || '';

  // Solo Mario necesita revisión/aprobación humana en este sistema — Owner Operators,
  // Lázaro y Dionisio están fuera de alcance salvo para combustible (spec 7.3a).
  const review = state.loads.filter(l => l.approval === 'Pendiente' && l.status !== 'Cancelada' && l.status !== 'Reemplazada' && (!l.driverId || driverGroup(l.driverId) === 'Mario'));
  const official = state.loads.filter(isOfficial);
  const active = official.filter(isActive);
  const delivered = state.loads.filter(l => l.status === 'Entregada' || l.status === 'Completada');
  const cancelled = state.loads.filter(l => l.status === 'Cancelada');
  const visible = filter === 'Activas' ? active : filter === 'Todas' ? state.loads : filter === 'Por revisar' ? review : filter === 'Entregada' ? delivered : filter === 'Cancelada' ? cancelled : official.filter(l => l.status === filter);
  const filtered = visible.filter(l => `${l.loadNumber} ${l.broker} ${driverName(l.driverId)} ${truckUnit(l.truckId)} ${l.pickupCity} ${l.deliveryCity}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.pickupDate.localeCompare(a.pickupDate));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const pageRows = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  function open(type: Editor['type'], id = '') { setError(''); setNotice(''); setEditor({ type, id, revision: state.revision }); requestAnimationFrame(() => document.getElementById('loads-editor')?.scrollIntoView({ block: 'start', behavior: 'instant' })); }
  async function quickApprove(id: string) {
    if (busy) return; setError(''); setNotice(''); setBusy(true);
    try { const next = await loads.commit({ type: 'approve', id, reason: '' }, state.revision); setNotice(next.events[0].detail); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
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
      } else if (editor.type === 'reject') action = { type: 'reject', id: editor.id, reason: text('reason') };
      else action = { type: 'cancel', id: editor.id, reason: text('reason') };
      const next = await loads.commit(action, editor.revision);
      setEditor(null); setNotice(next.events[0].detail);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const changeFilter = (next: string) => { setFilter(next); setEditor(null); setQuery(''); setError(''); setNotice(''); setPage(1); };
  const dateRange = (l: Load) => `${dayLabel(l.pickupDate)}${l.deliveryDate ? ` → ${dayLabel(l.deliveryDate)}` : ''}`;
  const editorTitle = editor?.type === 'load' ? `${editor.id ? t('Editar') : t('Agregar')} ${t('carga')}` : editor?.type === 'reject' ? t('Rechazar carga') : editor?.type === 'cancel' ? t('Cancelar carga') : t('Reemplazar carga');
  const statusBadgeClass = (l: Load) => l.approval === 'Pendiente' ? styles.badgeReview : l.approval === 'Rechazada' ? styles.badgeRejected : l.status === 'Cancelada' ? styles.badgeCancelled : ['Entregada', 'Completada'].includes(l.status) ? styles.badgeApproved : styles.badgeActive;

  return <div className={styles.loads}>
    {loads.error && <div role="alert" className={styles.error}>{loads.error} <button onClick={() => void loads.refresh()}>{t('Reintentar')}</button></div>}
    {!ready && !loads.error && <p role="status">{t('Abriendo los registros de cargas…')}</p>}

    <div className={styles.alertBanner}>
      <div className={styles.alertBannerIcon} aria-hidden="true"><AlertTriangle size={18} strokeWidth={2.5}/></div>
      <div className={styles.alertBannerText}><strong>{ready ? review.length : '—'} {t('cargas requieren tu aprobación')}</strong><span>{t('Revisa y confirma para continuar con el proceso.')}</span></div>
      <button className={styles.alertBannerBtn} onClick={() => changeFilter('Por revisar')}>{t('Revisar ahora →')}</button>
    </div>

    <div className={styles.statCards}>
      <button className={styles.statCard} data-tone="amber" aria-pressed={filter === 'Por revisar'} onClick={() => changeFilter('Por revisar')}><span className={styles.statIcon} aria-hidden="true"><Clock size={16}/></span><span className={styles.statLabel}>{t('Por revisar')}</span><strong>{ready ? review.length : '—'}</strong><small>{t('Cargas pendientes')}</small></button>
      <button className={styles.statCard} data-tone="green" aria-pressed={filter === 'Activas'} onClick={() => changeFilter('Activas')}><span className={styles.statIcon} aria-hidden="true"><Truck size={16}/></span><span className={styles.statLabel}>{t('Activas')}</span><strong>{ready ? active.length : '—'}</strong><small>{t('En tránsito o asignadas')}</small></button>
      <button className={styles.statCard} data-tone="blue" aria-pressed={filter === 'Todas'} onClick={() => changeFilter('Todas')}><span className={styles.statIcon} aria-hidden="true"><ClipboardList size={16}/></span><span className={styles.statLabel}>{t('Total registradas')}</span><strong>{ready ? state.loads.length : '—'}</strong><small>{t('Todas las cargas')}</small></button>
      <button className={styles.statCard} data-tone="red" aria-pressed={filter === 'Cancelada'} onClick={() => changeFilter('Cancelada')}><span className={styles.statIcon} aria-hidden="true"><XCircle size={16}/></span><span className={styles.statLabel}>{t('Canceladas')}</span><strong>{ready ? cancelled.length : '—'}</strong><small>{t('Cargas canceladas')}</small></button>
    </div>
    {notice && <p role="status" className={styles.success}>{notice}</p>}

    <div className={styles.toolbarRow}>
      <label className={styles.searchField}><Search size={17} aria-hidden="true"/><input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder={t('Número, broker, chofer, camión o ciudad...')} /></label>
      <button type="button" className={styles.filtersBtn} aria-haspopup="true"><SlidersHorizontal size={16}/> {t('Filtros')}</button>
      <button className={styles.primary} disabled={!ready || busy} onClick={() => open('load')}>{t('+ Registrar carga')}</button>
    </div>

    <nav className={styles.tabs} aria-label={t('Secciones de cargas')}>
      <button aria-pressed={filter === 'Todas'} onClick={() => changeFilter('Todas')}>{t('Todas')} ({state.loads.length})</button>
      <button aria-pressed={filter === 'Por revisar'} onClick={() => changeFilter('Por revisar')}>{t('Por revisar')} ({review.length})</button>
      <button aria-pressed={filter === 'Activas'} onClick={() => changeFilter('Activas')}>{t('Activas')} ({active.length})</button>
      <button aria-pressed={filter === 'Entregada'} onClick={() => changeFilter('Entregada')}>{t('Entregadas')} ({delivered.length})</button>
      <button aria-pressed={filter === 'Cancelada'} onClick={() => changeFilter('Cancelada')}>{t('Canceladas')} ({cancelled.length})</button>
    </nav>

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
      {editor.type === 'reject' && <><p>{t('La carga queda en el historial marcada como rechazada — nunca cuenta como ingreso.')}</p><label>{t('Motivo del rechazo *')}<input name="reason" required maxLength={500} /></label></>}
      {editor.type === 'cancel' && <><p>{t('La carga no se borra: queda cancelada en el historial con el motivo.')}</p><label>{t('Motivo de la cancelación *')}<input name="reason" required maxLength={500} /></label></>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Guardando…') : t('Guardar')}</button><button type="button" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>{t('Cancelar')}</button></div>
    </form>}

    <div className={styles.tableWrap}>
      <table className={styles.dataTable}>
        <thead><tr>
          <th>{t('Chofer / Carga')}</th>
          <th>{t('Origen → Destino')}</th>
          <th>{t('Estado')}</th>
          <th>{t('Fecha')}</th>
          <th>{t('Monto')}</th>
          <th aria-hidden="true"></th>
        </tr></thead>
        <tbody>{pageRows.map(l => <tr key={l.id}>
          <td><strong>{l.driverId ? driverName(l.driverId) : t('Sin chofer')}</strong><span className={styles.tableSub}>{l.loadNumber || t('Sin número')}</span></td>
          <td>{l.pickupState || '—'} → {l.deliveryState || '—'}</td>
          <td><span className={`${styles.badge} ${statusBadgeClass(l)}`}>{l.approval === 'Pendiente' ? t('Por revisar') : l.approval === 'Rechazada' ? t('Rechazada') : t(l.status)}</span>{l.missingPod && <span className={`${styles.badge} ${styles.badgeReview}`}>{t('Falta POD')}</span>}</td>
          <td className={styles.tableSub}>{dateRange(l)}</td>
          <td>{money(l.amount)}</td>
          <td className={styles.tableActions}>
            <button className={styles.moreBtn} onClick={() => setMenuOpen(menuOpen === l.id ? null : l.id)} aria-haspopup="true" aria-expanded={menuOpen === l.id} aria-label={t('Acciones')}><MoreVertical size={18}/></button>
            {menuOpen === l.id && <div className={styles.actionMenu} role="menu">
              {l.approval === 'Pendiente' && <button disabled={busy} onClick={() => { setMenuOpen(null); quickApprove(l.id); }}>{t('Aprobar')}</button>}
              {l.approval === 'Pendiente' && <button onClick={() => { setMenuOpen(null); open('reject', l.id); }}>{t('Rechazar')}</button>}
              <button onClick={() => { setMenuOpen(null); open('load', l.id); }}>{t('Editar')}</button>
              {l.status !== 'Cancelada' && l.status !== 'Reemplazada' && <button onClick={() => { setMenuOpen(null); open('cancel', l.id); }}>{t('Cancelar')}</button>}
              {l.status === 'Cancelada' && !l.replacedBy && <button onClick={() => { setMenuOpen(null); open('replace', l.id); }}>{t('Reemplazar')}</button>}
            </div>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>
    {ready && !filtered.length && <p className={styles.empty}>{query ? t('No hay resultados con estos filtros.') : t('Todavía no hay cargas en esta vista. Usa el botón de arriba para comenzar.')}</p>}
    {filtered.length > 0 && <div className={styles.pagination}>
      <span>{t('Mostrando')} {(pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, filtered.length)} {t('de')} {filtered.length} {t('cargas')}</span>
      <div className={styles.pageButtons}>
        <button disabled={pageSafe <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} aria-label={t('Anterior')}>‹</button>
        {Array.from({ length: pageCount }, (_, i) => i + 1).map(n => <button key={n} aria-pressed={pageSafe === n} onClick={() => setPage(n)}>{n}</button>)}
        <button disabled={pageSafe >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))} aria-label={t('Siguiente')}>›</button>
      </div>
    </div>}

    <section className={styles.profile}><div className={styles.toolbar}><h2>{t('Historial de cambios')}</h2></div>{state.events.length ? <div className={styles.historyScroll}><ul>{state.events.slice(0, 30).map(ev => <li key={ev.id}>{dateTime(ev.at)} — {ev.detail}</li>)}</ul></div> : <p className={styles.empty}>{t('Todavía no hay actividad.')}</p>}</section>
  </div>;
}
