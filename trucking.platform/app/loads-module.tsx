"use client";
import { useState, type FormEvent } from 'react';
import { LOAD_STATUS_VALUES, PAYMENT_STATUS_VALUES, isOfficial, isActive, type Load, type LoadAction, type LoadStatus, type PaymentStatus } from '../lib/loads';
import { isCargoDriver } from '../lib/fleet';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import { money, dayLabel, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { Truck, ClipboardList, Search, SlidersHorizontal } from 'lucide-react';
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
  const groupDriverCount = (g: string) => fleet.state.drivers.filter(d => d.group === g && d.active && isCargoDriver(d)).length;

  // Grupos de la flota (pedido explícito): Mario, Owner Operators y Lázaro —
  // al elegir uno se ve solo sus choferes y sus cargas.
  const groupLoads = groupFilter ? state.loads.filter(l => driverGroup(l.driverId) === groupFilter) : state.loads;
  const official = groupLoads.filter(isOfficial);
  const active = official.filter(isActive);
  const searched = groupLoads.filter(l => `${l.loadNumber} ${l.broker} ${driverName(l.driverId)} ${l.pickupState} ${l.deliveryState}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.pickupDate.localeCompare(a.pickupDate));
  // Carriles horizontales por estado (pedido explícito) en vez de una sola
  // lista vertical paginada — cada uno se desliza con el dedo. "Pendientes"
  // son cargas ya entregadas pero que Mario todavía no ha pagado — se separan
  // de "Entregadas" (ya cobradas) para que salte a la vista qué falta cobrar.
  const programadas = searched.filter(l => ['Programado', 'Cargando', 'Pendiente de documentos'].includes(l.status));
  const enTransito = searched.filter(l => l.status === 'En tránsito');
  const entregadasTodas = searched.filter(l => l.status === 'Entregada' || l.status === 'Completada');
  const pendientesPago = entregadasTodas.filter(l => l.paymentStatus !== 'Pagada');
  const entregadas = entregadasTodas.filter(l => l.paymentStatus === 'Pagada');
  // Un color por carril (pedido explícito): gris/azul/naranja/verde — así se
  // distingue de un vistazo sin tener que leer la etiqueta.
  const rails = [
    { key: 'Programado', label: t('Programadas'), badge: t('Programada'), rows: programadas, tone: 'gray' },
    { key: 'En tránsito', label: t('En tránsito'), badge: t('En tránsito'), rows: enTransito, tone: 'blue' },
    { key: 'Pendiente', label: t('Pendientes de pago'), badge: t('Pendiente de pago'), rows: pendientesPago, tone: 'orange' },
    { key: 'Pagada', label: t('Pagadas'), badge: t('Pagada'), rows: entregadas, tone: 'green' },
  ];

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
          loadNumber: text('loadNumber'), broker: '',
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
      <button aria-pressed={groupFilter === null} onClick={() => changeGroup(null)}>{t('Todos los grupos')}</button>
      {FLEET_GROUPS.map(g => <button key={g} aria-pressed={groupFilter === g} onClick={() => changeGroup(g)}>{g === 'Mario' ? t('Grupo Mario') : g === 'Owner Operators' ? t('Owner Operators') : t('Grupo Lázaro')} ({groupDriverCount(g)})</button>)}
    </nav>

    <div className={styles.statCards}>
      <div className={styles.statCard} data-tone="green"><span className={styles.statIcon} aria-hidden="true"><Truck size={16}/></span><span className={styles.statLabel}>{t('Activas')}</span><strong>{ready ? active.length : '—'}</strong><small>{t('En tránsito o asignadas')}</small></div>
      <div className={styles.statCard} data-tone="blue"><span className={styles.statIcon} aria-hidden="true"><ClipboardList size={16}/></span><span className={styles.statLabel}>{t('Total registradas')}</span><strong>{ready ? state.loads.length : '—'}</strong><small>{t('Todas las cargas')}</small></div>
    </div>
    {notice && <p role="status" className={styles.success}>{notice}</p>}

    <div className={styles.toolbarRow}>
      <label className={styles.searchField}><Search size={17} aria-hidden="true"/><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Número, chofer o estado...')} /></label>
      <button type="button" className={styles.filtersBtn} aria-haspopup="true"><SlidersHorizontal size={16}/> {t('Filtros')}</button>
      <button className={styles.primary} disabled={!ready || busy} onClick={() => open('load')}>{t('+ Registrar carga')}</button>
    </div>

    {editor && <form id="loads-editor" className={styles.form} onSubmit={submit} key={`${editor.type}-${editor.id}`}>
      <h3>{editorTitle}</h3>
      {(editor.type === 'load' || editor.type === 'replace') && <div className={styles.fields}>
        <label>{t('Chofer')}<select name="driverId" defaultValue={editor.type === 'load' ? editLoad?.driverId || '' : target?.driverId || ''}><option value="">{t('Sin asignar')}</option>{fleet.state.drivers.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>{t('Número de carga')}<input name="loadNumber" maxLength={100} defaultValue={editor.type === 'load' ? editLoad?.loadNumber : ''} /></label>
        <label>{t('Tarifa (monto bruto)')}<input name="amount" type="number" step="0.01" min="0" defaultValue={editor.type === 'load' ? editLoad?.amount ?? 0 : 0} /></label>
        <label>{t('Estado de recogida')}<input name="pickupState" maxLength={50} defaultValue={editor.type === 'load' ? editLoad?.pickupState : ''} /></label>
        <label>{t('Estado de entrega')}<input name="deliveryState" maxLength={50} defaultValue={editor.type === 'load' ? editLoad?.deliveryState : ''} /></label>
        <label>{t('Fecha de recogida *')}<input name="pickupDate" type="date" required defaultValue={editor.type === 'load' ? (editLoad?.pickupDate || today()) : today()} /></label>
        <label>{t('Fecha de entrega')}<input name="deliveryDate" type="date" defaultValue={editor.type === 'load' ? editLoad?.deliveryDate : ''} /></label>
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

    {rails.map(rail => <section className={styles.rail} key={rail.key}>
      <h3 className={styles.railTitle}>{rail.label} <span className={styles.count}>{rail.rows.length}</span></h3>
      {rail.rows.length ? <div className={styles.railScroll}>{rail.rows.map(l => <article className={styles.card} data-tone={rail.tone} key={l.id}>
        <div className={styles.badgeRow}>
          <span className={styles.badge} data-tone={rail.tone}>{rail.badge}</span>
          {l.missingPod && <span className={`${styles.badge} ${styles.badgeReview}`}>{t('Falta POD')}</span>}
        </div>
        <strong>{l.loadNumber || t('Sin número')} {l.broker && `· ${l.broker}`}</strong>
        <span>{l.pickupState || '—'} → {l.deliveryState || '—'}</span>
        <span>{dateRange(l)}</span>
        <span>{l.driverId ? driverName(l.driverId) : t('Sin chofer')}{!groupFilter && l.driverId && driverGroup(l.driverId) && ` · ${driverGroup(l.driverId)}`}</span>
        <p><b>{t('Tarifa:')}</b> {money(l.amount)} · <b>{t('Pago:')}</b> {t(l.paymentStatus)} {l.amountReceived > 0 && `(${money(l.amountReceived)} ${t('recibido')})`}</p>
        {l.replacedBy && <span>{t('Reemplazada por:')} {state.loads.find(x => x.id === l.replacedBy)?.loadNumber || l.replacedBy}</span>}
        {l.replacesId && <span>{t('Reemplaza a:')} {state.loads.find(x => x.id === l.replacesId)?.loadNumber || l.replacesId}</span>}
        <div className={styles.actions}>
          <button onClick={() => open('load', l.id)}>{t('Editar')}</button>
          <button onClick={() => open('cancel', l.id)}>{t('Cancelar')}</button>
        </div>
      </article>)}</div>
        : <p className={styles.empty}>{ready ? t('No hay cargas aquí todavía.') : t('Cargando…')}</p>}
    </section>)}
  </div>;
}
