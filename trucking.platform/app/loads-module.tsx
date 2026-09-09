"use client";
import { useState, type FormEvent } from 'react';
import { LOAD_STATUS_VALUES, PAYMENT_STATUS_VALUES, isOfficial, computeDriverTrips, type Load, type LoadAction, type LoadStatus, type PaymentStatus } from '../lib/loads';
import { isCargoDriver } from '../lib/fleet';
import { driverPayForGross } from '../lib/settlements';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import type { SettlementsController } from '../lib/use-settlements';
import { money, dayLabel, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import styles from './loads.module.css';

type Editor = { type: 'load' | 'cancel' | 'replace' | 'incident'; id: string; revision: number };
const FLEET_GROUPS = ['Mario', 'Owner Operators', 'Lázaro'] as const;

export default function LoadsModule({ loads, fleet, settlements, lang, t, initialFilter }: { loads: LoadsController; fleet: FleetController; settlements: SettlementsController; lang: Lang; t: (es: string) => string; initialFilter?: string }) {
  const { state, ready } = loads;
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  // Pago real del chofer de Mario por viaje (pedido explícito): puede ser
  // distinto al salario estimado por tramos — se anota aquí mismo, en el
  // recorrido, en vez de en Contabilidad, porque el período es el viaje
  // (desde que sale de FL), no la semana fija del negocio.
  const [payTrip, setPayTrip] = useState<{ driverId: string; driverName: string; tripStart: string } | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payBusy, setPayBusy] = useState(false), [payError, setPayError] = useState('');
  const driverName = (id: string) => fleet.state.drivers.find(d => d.id === id)?.name || '';
  const groupDriverCount = (g: string) => fleet.state.drivers.filter(d => d.group === g && d.active && isCargoDriver(d)).length;

  // Resumen chiquito (pedido explícito): las cargas que tocan entregarse hoy,
  // para que la dueña las chequee de un vistazo — sin botones, solo lista.
  // Este resumen no se separa por grupo (pedido explícito) — se ven todas
  // juntas, una debajo de otra. Se quedan aquí mientras no salgan pagadas en
  // Summar, sin importar si ya se marcaron "Entregada" operativamente.
  const dueToday = state.loads.filter(l => isOfficial(l) && l.status !== 'Cancelada' && l.status !== 'Reemplazada' && l.paymentStatus !== 'Pagada' && l.deliveryDate === today());
  // Recordatorio de pago semanal (pedido explícito): cuándo salió cada
  // chofer de FL y qué cargas ha hecho desde entonces, para saber cuándo y
  // cuánto pagarle aunque se pase semanas sin volver.
  const tripDrivers = groupFilter ? fleet.state.drivers.filter(d => d.group === groupFilter) : fleet.state.drivers;
  // Un viaje ya pagado (grupo Mario) sale de la lista solo — ya no hace
  // falta seguir recordándolo (pedido explícito).
  const driverTrips = ready ? computeDriverTrips(tripDrivers, state.loads, today()).filter(trip => {
    if (trip.group !== 'Mario') return true;
    const mark = settlements.state.marks.find(m => m.driverId === trip.driverId && m.weekStart === trip.tripStart);
    return mark?.paymentStatus !== 'Pagada';
  }) : [];

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
          incidentNote: '', incidentCost: 0, incidentReportedAt: '',
        };
        action = editor.type === 'load' ? { type: 'load', record, reason: text('reason') } : { type: 'replace', id: editor.id, replacement: record, reason: text('reason') };
      } else if (editor.type === 'cancel') {
        action = { type: 'cancel', id: editor.id, reason: text('reason') };
      } else {
        action = { type: 'incident', id: editor.id, note: text('incidentNote'), cost: num('incidentCost') };
      }
      const next = await loads.commit(action, editor.revision);
      setEditor(null); setNotice(next.events[0].detail);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const changeGroup = (next: string | null) => { setGroupFilter(next); setEditor(null); setError(''); setNotice(''); };
  async function submitPay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!payTrip || payBusy) return;
    const amount = Number(payAmount);
    if (!(amount >= 0)) { setPayError(t('Escribe un monto válido.')); return; }
    setPayBusy(true); setPayError('');
    try {
      await settlements.commit({ type: 'mark', driverId: payTrip.driverId, driverName: payTrip.driverName, weekStart: payTrip.tripStart, paymentStatus: 'Pagada', notes: '', amountPaid: amount });
      setPayTrip(null); setPayAmount('');
    } catch (e) { setPayError((e as Error).message); } finally { setPayBusy(false); }
  }
  async function reopenPay(driverId: string, driverName: string, tripStart: string) {
    try { await settlements.commit({ type: 'mark', driverId, driverName, weekStart: tripStart, paymentStatus: 'Pendiente', notes: '' }); } catch (e) { setPayError((e as Error).message); }
  }
  const editorTitle = editor?.type === 'load' ? `${editor.id ? t('Editar') : t('Agregar')} ${t('carga')}` : editor?.type === 'cancel' ? t('Cancelar carga') : editor?.type === 'incident' ? t('Reportar rotura de camión') : t('Reemplazar carga');

  return <div className={styles.loads}>
    {loads.error && <div role="alert" className={styles.error}>{loads.error} <button onClick={() => void loads.refresh()}>{t('Reintentar')}</button></div>}
    {!ready && !loads.error && <p role="status">{t('Abriendo los registros de cargas…')}</p>}

    <section className={styles.dueTodayBox}>
      <h3 className={styles.dueTodayTitle}>📦 {t('Cargas que se entregan hoy')} <span className={styles.count}>{dueToday.length}</span></h3>
      {dueToday.length
        ? <ul className={styles.dueTodayList}>{dueToday.map(l => <li key={l.id}>
            <strong>{l.driverId ? driverName(l.driverId) : t('Sin chofer')}</strong> — {t('Carga')} {l.loadNumber || t('sin número')} — {money(l.amount)}
          </li>)}</ul>
        : <p className={styles.empty}>{t('No hay cargas para entregar hoy.')}</p>}
    </section>

    <nav className={styles.tabs} aria-label={t('Grupos de la flota')}>
      <button aria-pressed={groupFilter === null} onClick={() => changeGroup(null)}>{t('Todos los grupos')}</button>
      {FLEET_GROUPS.map(g => <button key={g} aria-pressed={groupFilter === g} onClick={() => changeGroup(g)}>{g === 'Mario' ? t('Grupo Mario') : g === 'Owner Operators' ? t('Owner Operators') : t('Grupo Lázaro')} ({groupDriverCount(g)})</button>)}
    </nav>

    <section className={styles.tripBox}>
      <h3 className={styles.dueTodayTitle}>🧭 {t('Recorrido de cada chofer (desde que salió de FL)')} <span className={styles.count}>{driverTrips.length}</span></h3>
      {driverTrips.length
        ? <div className={styles.tripList}>{driverTrips.map(trip => {
            const gross = trip.loads.reduce((s, l) => s + l.amount, 0);
            const isMario = trip.group === 'Mario';
            const estimatedPay = isMario ? driverPayForGross(gross, settlements.state.config) : 0;
            const mark = isMario ? settlements.state.marks.find(m => m.driverId === trip.driverId && m.weekStart === trip.tripStart) : undefined;
            const isPaid = mark?.paymentStatus === 'Pagada';
            const isPayingThis = payTrip?.driverId === trip.driverId && payTrip?.tripStart === trip.tripStart;
            return <div className={styles.tripCard} key={trip.driverId} data-tone={trip.daysOut > 10 ? 'red' : trip.daysOut > 7 ? 'orange' : 'gray'}>
            <strong>{trip.driverName}</strong> <span className={styles.tableSub}>({trip.group})</span>
            <span>{t('Salió de FL:')} {dayLabel(trip.tripStart)} — <b>{trip.daysOut} {t('días fuera')}</b></span>
            <ul className={styles.tripLoads}>{trip.loads.map(l => <li key={l.id} className={styles.tripLoadRow}>
              <details className={styles.loadMenu}>
                <summary aria-label={t('Opciones de la carga')}>☰</summary>
                <div className={styles.loadMenuActions}>
                  <button type="button" onClick={() => open('load', l.id)}>{t('Editar')}</button>
                  <button type="button" onClick={() => open('incident', l.id)}>{l.incidentNote ? t('Editar rotura') : t('Reportar rotura')}</button>
                  <button type="button" onClick={() => open('cancel', l.id)}>{t('Cancelar')}</button>
                </div>
              </details>
              <span>
                {dayLabel(l.pickupDate)} → {l.deliveryDate ? dayLabel(l.deliveryDate) : t('sin fecha de entrega')}: {l.pickupState || '—'} → {l.deliveryState || '—'}{l.loadNumber && ` (#${l.loadNumber})`} — {money(l.amount)}
                {l.incidentNote && <span className={styles.tripIncidentTag}>🔧 {t('Retrasada')}</span>}
                {l.paymentStatus === 'Pagada' && <span className={styles.tripPaidTag}>{t('Pagada')}</span>}
              </span>
            </li>)}</ul>
            {isMario && <>
              <p className={styles.tripTotals}><b>{t('Total en cargas:')}</b> {money(gross)} <span className={styles.tripDivider}>—</span> <b>{t('Salario estimado:')}</b> {money(estimatedPay)}</p>
              {isPaid && <p className={styles.tripPaidLine}>✅ {t('Pagado:')} {money(mark!.amountPaid)}
                <button type="button" onClick={() => { setPayTrip({ driverId: trip.driverId, driverName: trip.driverName, tripStart: trip.tripStart }); setPayAmount(String(mark!.amountPaid)); setPayError(''); }}>{t('Editar')}</button>
                <button type="button" onClick={() => void reopenPay(trip.driverId, trip.driverName, trip.tripStart)}>{t('Marcar pendiente')}</button>
              </p>}
              {isPayingThis
                ? <form onSubmit={submitPay} className={styles.payForm}>
                    <input type="number" step="0.01" min="0" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder={t('Monto pagado')} autoFocus />
                    <button type="submit" disabled={payBusy}>{payBusy ? t('Guardando…') : t('Confirmar')}</button>
                    <button type="button" disabled={payBusy} onClick={() => { setPayTrip(null); setPayError(''); }}>{t('Cancelar')}</button>
                  </form>
                : !isPaid && <button type="button" onClick={() => { setPayTrip({ driverId: trip.driverId, driverName: trip.driverName, tripStart: trip.tripStart }); setPayAmount(estimatedPay.toFixed(2)); setPayError(''); }}>{t('Marcar como pagado')}</button>}
              {isPayingThis && payError && <p className={styles.error} role="alert">{payError}</p>}
            </>}
          </div>;
          })}</div>
        : <p className={styles.empty}>{ready ? t('Todos los choferes están en FL ahora mismo.') : t('Cargando…')}</p>}
    </section>

    {notice && <p role="status" className={styles.success}>{notice}</p>}

    <div className={styles.toolbarRow}>
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
      {editor.type === 'incident' && <div className={styles.fields}>
        <p className={styles.wide}>{t('Anota qué se rompió y cuánto costó, para que quede la carga marcada como atrasada por rotura.')}</p>
        <label className={styles.wide}>{t('¿Qué se rompió?')}<input name="incidentNote" maxLength={500} placeholder={t('Ej: se ponchó una llanta, se rompió el motor…')} defaultValue={target?.incidentNote} /></label>
        <label>{t('Costo de la reparación')}<input name="incidentCost" type="number" step="0.01" min="0" defaultValue={target?.incidentCost ?? 0} /></label>
        <p className={styles.wide}><small>{t('Deja "¿Qué se rompió?" vacío y guarda para quitar el reporte cuando ya esté resuelto.')}</small></p>
      </div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Guardando…') : t('Guardar')}</button><button type="button" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>{t('Cancelar')}</button></div>
    </form>}

  </div>;
}
