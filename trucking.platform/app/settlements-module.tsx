"use client";
import { useState, type FormEvent } from 'react';
import {
  computeMarioSettlements, dispatcherCommissionDetail, invoiceNumberFor,
  weekStartOf, weekRange, isWeekLocked, type SettlementConfig,
} from '../lib/settlements';
import { isOfficial } from '../lib/loads';
import { summarizeFuel } from '../lib/fuel';
import type { SettlementsController } from '../lib/use-settlements';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import type { FuelController } from '../lib/use-fuel';
import { money, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { Truck, Fuel as FuelIcon, Users, TrendingUp, ChevronLeft, ChevronRight, Settings, X, ShieldCheck, Lock } from 'lucide-react';
import styles from './settlements.module.css';

// REDISEÑO (pedido explícito de la dueña): Contabilidad y Pagos ahora tiene
// SOLO 2 secciones visibles — "Esta semana" (4 números) y "Pagos a Choferes"
// (Pendientes/Pagados) — sin duplicar nada de lo que ya se ve en Recorrido de
// cada chofer (Cargas) ni en Reportes (grupos Owner Operators/Lázaro, que por
// eso ya no tienen pestaña aquí). Las 4 funciones que sí existían pero no
// entran en ese diseño simple (comisión del despachador/Gleybis, seguro
// semanal, configuración de %/tramos, cerrar-reabrir invoice) se conservan
// intactas, solo que movidas detrás del botón "⚙️ Más opciones" para que la
// pantalla principal quede limpia.
type PagosTab = 'pendientes' | 'pagados';
type MoreTab = 'dispatcher' | 'insurance' | 'config' | 'lock';
const AVATAR_TONES = ['#8B102A', '#1e4e8c', '#8a5a00', '#1f7a4d', '#6b3fa0', '#a12b2b'];
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
function Avatar({ name, index }: { name: string; index: number }) {
  return <span className={styles.avatar} style={{ background: AVATAR_TONES[index % AVATAR_TONES.length] }}>{initials(name)}</span>;
}

export default function SettlementsModule({ settlements, loads, fuel, fleet, lang, t }: {
  settlements: SettlementsController; loads: LoadsController; fuel: FuelController; fleet: FleetController; lang: Lang; t: (es: string) => string;
}) {
  const { state, ready } = settlements;
  const [pagosTab, setPagosTab] = useState<PagosTab>('pendientes');
  const [weekStart, setWeekStart] = useState(weekStartOf(today()));
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false), [moreTab, setMoreTab] = useState<MoreTab>('dispatcher');

  const ready2 = ready && loads.ready && fuel.ready && fleet.ready;
  const { end: weekEnd, prevWeek, nextWeek } = weekRange(weekStart);
  const weekLabel = `${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(`${weekStart}T12:00:00Z`))} – ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(new Date(`${weekEnd}T12:00:00Z`).getTime() - 86400000))}`;
  const locked = isWeekLocked(weekEnd, state.weekLocks);
  const weekLock = state.weekLocks.find(w => w.weekEnd === weekEnd);

  const mario = computeMarioSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd, state.config, state.driverInsurance, state.marks, weekStart, weekEnd);
  const dispatcher = dispatcherCommissionDetail(fleet.state.drivers, loads.state.loads, weekStart, weekEnd, state.config, state.weekLocks);
  const invoiceNumber = invoiceNumberFor(weekStart);
  const dispatcherMark = state.dispatcherMarks.find(m => m.weekStart === weekStart);
  const dispatcherPaid = dispatcherMark?.paymentStatus === 'Pagada';

  // Los 4 números de "Esta semana" — siempre calculados en vivo desde lo que
  // ya existe en Cargas/Combustible/Recorrido de cada chofer, nunca captura
  // manual (pedido explícito): así una corrección posterior (ej. Summar) se
  // refleja sola sin tener que "actualizar" nada aquí.
  const cargasRealizadas = loads.state.loads
    .filter(l => isOfficial(l) && l.status !== 'Cancelada' && l.pickupDate >= weekStart && l.pickupDate < weekEnd)
    .reduce((s, l) => s + l.amount, 0);
  const fuelSummary = summarizeFuel(fuel.state, weekStart, weekEnd);
  const combustibleYGastos = fuelSummary.fuel + fuelSummary.nonFuel + fuelSummary.expenseTotal;
  const pagoAChoferes = mario.filter(m => m.paymentStatus === 'Pagada').reduce((s, m) => s + m.driverPay, 0);
  const dineroQueQueda = cargasRealizadas - combustibleYGastos - pagoAChoferes;

  const pendientes = mario.filter(m => m.paymentStatus === 'Pendiente');
  const pagados = mario.filter(m => m.paymentStatus === 'Pagada');
  const rows = pagosTab === 'pendientes' ? pendientes : pagados;

  async function toggleMark(driverId: string, driverName: string, current: 'Pendiente' | 'Pagada') {
    if (busy || locked) return; setError(''); setNotice(''); setBusy(true);
    try {
      const next = await settlements.commit({ type: 'mark', driverId, driverName, weekStart, paymentStatus: current === 'Pagada' ? 'Pendiente' : 'Pagada', notes: '' });
      setNotice(next.events[0].detail);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function toggleDispatcherMark(current: 'Pendiente' | 'Pagada') {
    if (busy) return; setError(''); setNotice(''); setBusy(true);
    try {
      const next = await settlements.commit({ type: 'dispatcherMark', weekStart, paymentStatus: current === 'Pagada' ? 'Pendiente' : 'Pagada', notes: '' });
      setNotice(next.events[0].detail);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function saveInsurance(driverId: string, amount: number) {
    if (busy || locked) return; setError(''); setNotice(''); setBusy(true);
    try { const next = await settlements.commit({ type: 'insurance', driverId, amount }); setNotice(next.events[0].detail); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function closeWeek() {
    if (busy || locked) return; setError(''); setNotice(''); setBusy(true);
    try { const next = await settlements.commit({ type: 'closeWeek', weekEnd }); setNotice(next.events[0].detail); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function reopenWeek() {
    if (busy || !locked) return; setError(''); setNotice(''); setBusy(true);
    try { const next = await settlements.commit({ type: 'reopenWeek', weekEnd }); setNotice(next.events[0].detail); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; const fields = new FormData(event.currentTarget);
    const num = (key: string) => Number(fields.get(key) || 0);
    const config: SettlementConfig = {
      companyDeductionPct: num('companyDeductionPct') / 100, dispatcherCommissionPct: num('dispatcherCommissionPct') / 100,
      tier1Max: num('tier1Max'), tier1Pay: num('tier1Pay'), tier2Max: num('tier2Max'), tier2Pay: num('tier2Pay'), tier3Pay: num('tier3Pay'),
      ownerOperatorCutPct: num('ownerOperatorCutPct') / 100,
    };
    setError(''); setNotice(''); setBusy(true);
    try { const next = await settlements.commit({ type: 'config', config }); setNotice(next.events[0].detail); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function openMore(tab: MoreTab) { setError(''); setNotice(''); setMoreTab(tab); setMoreOpen(true); }

  return <div className={styles.settlements}>
    {(settlements.error || loads.error || fuel.error || fleet.error) && <div role="alert" className={styles.error}>{settlements.error || loads.error || fuel.error || fleet.error}</div>}
    {!ready2 && <p role="status">{t('Abriendo los registros de contabilidad…')}</p>}

    <div className={styles.weekBar}>
      <button onClick={() => setWeekStart(prevWeek)} aria-label={t('Semana anterior')}><ChevronLeft size={16} /></button>
      <span>📅 {t('Semana')} {weekLabel}</span>
      <button onClick={() => setWeekStart(nextWeek)} aria-label={t('Semana siguiente')}><ChevronRight size={16} /></button>
      <button onClick={() => setWeekStart(weekStartOf(today()))}>{t('Semana actual')}</button>
      <button onClick={() => openMore('dispatcher')}><Settings size={15} /> {t('Más opciones')}</button>
    </div>
    {locked && weekLock && <p className={styles.note}>{t('Semana cerrada el')} {new Date(weekLock.lockedAt).toLocaleString('es')} — {t('los montos son finales y no se pueden editar.')}</p>}

    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}

    <h2>{t('Esta semana')}</h2>
    <div className={styles.statCards}>
      <div className={styles.statCard} data-tone="blue"><span className={styles.statIcon} aria-hidden="true"><Truck size={16} /></span><span className={styles.statLabel}>{t('Cargas realizadas')}</span><strong>{ready2 ? money(cargasRealizadas) : '—'}</strong></div>
      <div className={styles.statCard} data-tone="amber"><span className={styles.statIcon} aria-hidden="true"><FuelIcon size={16} /></span><span className={styles.statLabel}>{t('Combustible y gastos')}</span><strong>{ready2 ? money(combustibleYGastos) : '—'}</strong></div>
      <div className={styles.statCard} data-tone="red"><span className={styles.statIcon} aria-hidden="true"><Users size={16} /></span><span className={styles.statLabel}>{t('Pago a choferes')}</span><strong>{ready2 ? money(pagoAChoferes) : '—'}</strong></div>
    </div>
    <div className={styles.moneyCard}>
      <span className={styles.statIcon} aria-hidden="true"><TrendingUp size={18} /></span>
      <span className={styles.statLabel}>{t('Dinero que queda')}</span>
      <strong>{ready2 ? money(dineroQueQueda) : '—'}</strong>
    </div>

    <h2>{t('Pagos a Choferes')}</h2>
    <nav className={styles.tabs} aria-label={t('Estado de pago')}>
      <button aria-pressed={pagosTab === 'pendientes'} onClick={() => setPagosTab('pendientes')}>{t('Pendientes')} <span className={styles.count}>{pendientes.length}</span></button>
      <button aria-pressed={pagosTab === 'pagados'} onClick={() => setPagosTab('pagados')}>{t('Pagados')} <span className={styles.count}>{pagados.length}</span></button>
    </nav>
    <div className={styles.tableWrap}>
      <table className={styles.dataTable}>
        <thead><tr><th>{t('Chofer')}</th><th>{t('Cargas')}</th><th>{t('Salario')}</th><th>{t('Estado')}</th><th aria-hidden="true"></th></tr></thead>
        <tbody>{rows.map((m, i) => <tr key={m.driverId}>
          <td><span className={styles.who}><Avatar name={m.driverName} index={i} />{m.driverName}</span></td>
          <td className={styles.tableSub}>{m.loadsCount}</td>
          <td><strong>{money(m.driverPay)}</strong></td>
          <td><span className={`${styles.badge} ${m.paymentStatus === 'Pagada' ? styles.badgePaid : styles.badgePending}`}>{t(m.paymentStatus)}</span></td>
          <td className={styles.tableActions}>
            <button disabled={busy || locked} onClick={() => toggleMark(m.driverId, m.driverName, m.paymentStatus)}>{m.paymentStatus === 'Pagada' ? t('Marcar pendiente') : t('Marcar pagada')}</button>
          </td>
        </tr>)}</tbody>
      </table>
      {ready2 && !rows.length && <p className={styles.empty}>{pagosTab === 'pendientes' ? t('No hay pagos pendientes esta semana.') : t('Todavía no se ha marcado ningún pago como pagado esta semana.')}</p>}
    </div>

    {moreOpen && <div className={styles.moreOverlay} role="dialog" aria-label={t('Más opciones')}>
      <div className={styles.morePanel}>
        <div className={styles.morePanelHeader}>
          <strong>{t('Más opciones')}</strong>
          <button onClick={() => setMoreOpen(false)} aria-label={t('Cerrar')}><X size={20} /></button>
        </div>
        <nav className={styles.tabs} aria-label={t('Secciones de más opciones')}>
          <button aria-pressed={moreTab === 'dispatcher'} onClick={() => setMoreTab('dispatcher')}>{t('Dispatcher')} <span className={styles.count}>#{invoiceNumber}</span></button>
          <button aria-pressed={moreTab === 'insurance'} onClick={() => setMoreTab('insurance')}><ShieldCheck size={14} /> {t('Seguro')}</button>
          <button aria-pressed={moreTab === 'config'} onClick={() => setMoreTab('config')}><Settings size={14} /> {t('Configuración')}</button>
          <button aria-pressed={moreTab === 'lock'} onClick={() => setMoreTab('lock')}><Lock size={14} /> {t('Cerrar semana')}</button>
        </nav>

        {moreTab === 'dispatcher' && <>
          <div className={styles.rowDetail}>
            <h3>{t('Invoice')} #{invoiceNumber} — {t('comisión de Gleybis')}</h3>
            <p><b>{t('Bruto:')}</b> {money(dispatcher.gross)} · <b>{t('Comisión (4%):')}</b> {money(dispatcher.commission)}</p>
            <div className={styles.actions}>
              <span className={`${styles.badge} ${dispatcherPaid ? styles.badgePaid : styles.badgePending}`}>{dispatcherPaid ? t('Pagada') : t('Pendiente')}</span>
              <button disabled={busy} onClick={() => toggleDispatcherMark(dispatcherMark?.paymentStatus || 'Pendiente')}>{dispatcherPaid ? t('Marcar pendiente') : t('Marcar pagada')}</button>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead><tr><th>{t('Carga')}</th><th>{t('Chofer')}</th><th>{t('Grupo')}</th><th>{t('Bruto')}</th><th>{t('Comisión')}</th></tr></thead>
              <tbody>{dispatcher.rows.map(r => <tr key={r.loadId}>
                <td>{r.loadNumber || t('Sin número')}</td>
                <td>{r.driverName}</td>
                <td className={styles.tableSub}>{r.group}</td>
                <td className={styles.tableSub}>{money(r.amount)}</td>
                <td><strong>{money(r.commission)}</strong></td>
              </tr>)}</tbody>
            </table>
            {ready2 && !dispatcher.rows.length && <p className={styles.empty}>{t('No hay cargas pagadas en este invoice todavía.')}</p>}
          </div>
        </>}

        {moreTab === 'insurance' && <div className={styles.tableWrap}>
          <table className={styles.dataTable}>
            <thead><tr><th>{t('Chofer')}</th><th>{t('Seguro semanal')}</th><th aria-hidden="true"></th></tr></thead>
            <tbody>{mario.map((m, i) => <tr key={m.driverId}>
              <td><span className={styles.who}><Avatar name={m.driverName} index={i} />{m.driverName}</span></td>
              <td colSpan={2}>
                <form className={styles.insuranceForm} onSubmit={e => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get('insurance') || 0); void saveInsurance(m.driverId, v); }}>
                  <input name="insurance" type="number" min="0" step="0.01" defaultValue={m.insurance} disabled={locked} />
                  <button type="submit" disabled={busy || locked}>{t('Guardar')}</button>
                </form>
              </td>
            </tr>)}</tbody>
          </table>
          {ready2 && !mario.length && <p className={styles.empty}>{t('No hay choferes del grupo Mario todavía.')}</p>}
        </div>}

        {moreTab === 'config' && <form className={styles.form} onSubmit={saveConfig}>
          <h3>{t('Configuración de Contabilidad y Pagos')}</h3>
          <p className={styles.note}>{t('Estos valores son del ejemplo de la compañía actual, no reglas universales — ajústalos si cambian.')}</p>
          <div className={styles.fields}>
            <label>{t('Descuento de compañía (%)')}<input name="companyDeductionPct" type="number" min="0" max="100" step="0.1" defaultValue={state.config.companyDeductionPct * 100} /></label>
            <label>{t('Comisión del despachador (%)')}<input name="dispatcherCommissionPct" type="number" min="0" max="100" step="0.1" defaultValue={state.config.dispatcherCommissionPct * 100} /></label>
            <label>{t('Corte de Owner Operators (%)')}<input name="ownerOperatorCutPct" type="number" min="0" max="100" step="0.1" defaultValue={state.config.ownerOperatorCutPct * 100} /></label>
            <label>{t('Tramo 1 — bruto hasta')}<input name="tier1Max" type="number" min="0" step="1" defaultValue={state.config.tier1Max} /></label>
            <label>{t('Tramo 1 — pago')}<input name="tier1Pay" type="number" min="0" step="1" defaultValue={state.config.tier1Pay} /></label>
            <label>{t('Tramo 2 — bruto hasta')}<input name="tier2Max" type="number" min="0" step="1" defaultValue={state.config.tier2Max} /></label>
            <label>{t('Tramo 2 — pago')}<input name="tier2Pay" type="number" min="0" step="1" defaultValue={state.config.tier2Pay} /></label>
            <label>{t('Tramo 3 — pago (arriba del tramo 2)')}<input name="tier3Pay" type="number" min="0" step="1" defaultValue={state.config.tier3Pay} /></label>
          </div>
          <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Guardando…') : t('Guardar configuración')}</button></div>
        </form>}

        {moreTab === 'lock' && <div className={styles.rowDetail}>
          <h3>{t('Invoice de la semana')} {weekLabel}</h3>
          {locked && weekLock
            ? <p>{t('Esta semana está cerrada desde el')} {new Date(weekLock.lockedAt).toLocaleString('es')}. {t('Los montos son finales y no se pueden editar.')}</p>
            : <p>{t('Esta semana sigue abierta: los montos se pueden seguir marcando/editando. Ciérrala cuando quieras, no hay hora automática.')}</p>}
          <div className={styles.actions}>
            {locked
              ? <button disabled={busy} onClick={reopenWeek}>{t('Reabrir semana')}</button>
              : <button className={styles.primary} disabled={busy} onClick={closeWeek}>{t('Cerrar invoice de esta semana')}</button>}
          </div>
        </div>}
      </div>
    </div>}
  </div>;
}
