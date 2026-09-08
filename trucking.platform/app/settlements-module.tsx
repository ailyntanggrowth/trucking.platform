"use client";
import { useState, type FormEvent } from 'react';
import {
  computeMarioSettlements, computeOwnerOperatorSettlements, computeLazaroSettlements, dispatcherCommissionDetail, invoiceNumberFor,
  weekStartOf, weekRange, isWeekLocked, type SettlementConfig,
} from '../lib/settlements';
import type { SettlementsController } from '../lib/use-settlements';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import type { FuelController } from '../lib/use-fuel';
import { money, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { DollarSign, Fuel as FuelIcon, Percent, TrendingUp, ChevronLeft, ChevronRight, Settings, MoreVertical } from 'lucide-react';
import { Donut, DonutLegend } from './mini-charts';
import styles from './settlements.module.css';

type Tab = 'mario' | 'ownerOperators' | 'lazaro' | 'dispatcher' | 'config';
const AVATAR_TONES = ['#8B102A', '#1e4e8c', '#8a5a00', '#1f7a4d', '#6b3fa0', '#a12b2b'];
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
function Avatar({ name, index }: { name: string; index: number }) {
  return <span className={styles.avatar} style={{ background: AVATAR_TONES[index % AVATAR_TONES.length] }}>{initials(name)}</span>;
}

export default function SettlementsModule({ settlements, loads, fuel, fleet, lang, t }: {
  settlements: SettlementsController; loads: LoadsController; fuel: FuelController; fleet: FleetController; lang: Lang; t: (es: string) => string;
}) {
  const { state, ready } = settlements;
  const [tab, setTab] = useState<Tab>('mario');
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(weekStartOf(today()));
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);

  const ready2 = ready && loads.ready && fuel.ready && fleet.ready;
  const { end: weekEnd, prevWeek, nextWeek } = weekRange(weekStart);
  const locked = isWeekLocked(weekEnd, state.weekLocks);
  const weekLock = state.weekLocks.find(w => w.weekEnd === weekEnd);
  const mario = computeMarioSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd, state.config, state.driverInsurance, state.marks);
  const ownerOperators = computeOwnerOperatorSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd, state.config);
  const lazaro = computeLazaroSettlements(fleet.state.drivers, loads.state.loads, weekStart, weekEnd);
  const dispatcher = dispatcherCommissionDetail(fleet.state.drivers, loads.state.loads, weekStart, weekEnd, state.config, state.weekLocks);
  const invoiceNumber = invoiceNumberFor(weekStart);
  const dispatcherMark = state.dispatcherMarks.find(m => m.weekStart === weekStart);
  const dispatcherPaid = dispatcherMark?.paymentStatus === 'Pagada';
  const totalGross = mario.reduce((s, m) => s + m.gross, 0);
  const totalFuel = mario.reduce((s, m) => s + m.fuel, 0);
  const totalProfit = mario.reduce((s, m) => s + m.finalProfit, 0);
  const totalDriverPay = mario.reduce((s, m) => s + m.driverPay, 0);
  const totalInsurance = mario.reduce((s, m) => s + m.insurance, 0);
  const ooMarioCut = ownerOperators.reduce((s, o) => s + o.marioCut, 0);
  const ooFuel = ownerOperators.reduce((s, o) => s + o.fuel, 0);
  const weekLabel = `${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(`${weekStart}T12:00:00Z`))} – ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(new Date(`${weekEnd}T12:00:00Z`).getTime() - 86400000))}`;
  const distribution = [
    { label: t('Pago a choferes'), value: totalDriverPay, color: '#8B102A' },
    { label: t('Combustible'), value: totalFuel + ooFuel, color: '#c98a00' },
    { label: t('Corte Owner Operators (Mario)'), value: ooMarioCut, color: '#1e4e8c' },
    { label: t('Comisión despachador'), value: dispatcher.commission, color: '#1f7a4d' },
    { label: t('Seguro'), value: totalInsurance, color: '#6b3fa0' },
  ];
  const distributionTotal = distribution.reduce((s, d) => s + d.value, 0);

  async function toggleMark(driverId: string, driverName: string, current: 'Pendiente' | 'Pagada') {
    if (busy || locked) return; setError(''); setNotice(''); setBusy(true); setOpenRow(null);
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

  return <div className={styles.settlements}>
    {(settlements.error || loads.error || fuel.error || fleet.error) && <div role="alert" className={styles.error}>{settlements.error || loads.error || fuel.error || fleet.error}</div>}
    {!ready2 && <p role="status">{t('Abriendo los registros de contabilidad…')}</p>}

    <div className={styles.weekBar}>
      <button onClick={() => setWeekStart(prevWeek)} aria-label={t('Semana anterior')}><ChevronLeft size={16} /></button>
      <span>📅 {t('Semana')} {weekLabel}</span>
      <button onClick={() => setWeekStart(nextWeek)} aria-label={t('Semana siguiente')}><ChevronRight size={16} /></button>
      <button onClick={() => setWeekStart(weekStartOf(today()))}>{t('Semana actual')}</button>
      {locked
        ? <button disabled={busy} onClick={reopenWeek}>{t('Reabrir semana')}</button>
        : <button className={styles.primary} disabled={busy} onClick={closeWeek}>{t('Cerrar invoice de esta semana')}</button>}
    </div>
    {locked && weekLock && <p className={styles.note}>{t('Semana cerrada el')} {new Date(weekLock.lockedAt).toLocaleString('es')} — {t('los montos son finales y no se pueden editar. Ciérrala tú cuando quieras, no hay hora automática.')}</p>}

    <div className={styles.statCards}>
      <div className={styles.statCard} data-tone="primary"><span className={styles.statIcon} aria-hidden="true"><DollarSign size={16} /></span><span className={styles.statLabel}>{t('Bruto Mario')}</span><strong>{ready2 ? money(totalGross) : '—'}</strong></div>
      <div className={styles.statCard} data-tone="amber"><span className={styles.statIcon} aria-hidden="true"><FuelIcon size={16} /></span><span className={styles.statLabel}>{t('Combustible Mario')}</span><strong>{ready2 ? money(totalFuel) : '—'}</strong></div>
      <div className={styles.statCard} data-tone="red"><span className={styles.statIcon} aria-hidden="true"><Percent size={16} /></span><span className={styles.statLabel}>{t('Comisión despachador (4%)')}</span><strong>{ready2 ? money(dispatcher.commission) : '—'}</strong></div>
      <div className={styles.statCard} data-tone="green"><span className={styles.statIcon} aria-hidden="true"><TrendingUp size={16} /></span><span className={styles.statLabel}>{t('Ganancia estimada')}</span><strong>{ready2 ? money(totalProfit) : '—'}</strong></div>
    </div>
    <p className={styles.note}>{t('La comisión del despachador es un pago aparte: se calcula sobre el bruto de Mario + Owner Operators + Lázaro de la semana, todo junto, y no afecta el salario del chofer.')}</p>

    <nav className={styles.tabs} aria-label={t('Secciones de contabilidad')}>
      <button aria-pressed={tab === 'mario'} onClick={() => setTab('mario')}>{t('Choferes de Mario')} <span className={styles.count}>{mario.length}</span></button>
      <button aria-pressed={tab === 'ownerOperators'} onClick={() => setTab('ownerOperators')}>{t('Owner Operators')} <span className={styles.count}>{ownerOperators.length}</span></button>
      <button aria-pressed={tab === 'lazaro'} onClick={() => setTab('lazaro')}>{t('Grupo Lázaro')} <span className={styles.count}>{lazaro.length}</span></button>
      <button aria-pressed={tab === 'dispatcher'} onClick={() => setTab('dispatcher')}>{t('Dispatcher')} <span className={styles.count}>#{invoiceNumber}</span></button>
      <button aria-pressed={tab === 'config'} onClick={() => setTab('config')}><Settings size={14} /> {t('Configuración')}</button>
    </nav>
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}

    {tab === 'mario' && <div className={styles.tableWrap}>
      <table className={styles.dataTable}>
        <thead><tr><th>{t('Chofer')}</th><th>{t('Cargas')}</th><th>{t('Bruto')}</th><th>{t('Combustible')}</th><th>{t('Pago chofer')}</th><th>{t('Ganancia final')}</th><th>{t('Estado')}</th><th aria-hidden="true"></th></tr></thead>
        <tbody>{mario.map((m, i) => <tr key={m.driverId}>
          <td><span className={styles.who}><Avatar name={m.driverName} index={i} />{m.driverName}</span></td>
          <td className={styles.tableSub}>{m.loadsCount}</td>
          <td>{money(m.gross)}</td>
          <td className={styles.tableSub}>{money(m.fuel)}</td>
          <td><strong>{money(m.driverPay)}</strong></td>
          <td><strong className={m.finalProfit < 0 ? styles.negative : ''}>{money(m.finalProfit)}</strong></td>
          <td><span className={`${styles.badge} ${m.paymentStatus === 'Pagada' ? styles.badgePaid : styles.badgePending}`}>{t(m.paymentStatus)}</span></td>
          <td className={styles.tableActions}>
            <button className={styles.moreBtn} onClick={() => setOpenRow(openRow === m.driverId ? null : m.driverId)} aria-label={t('Más acciones')}><MoreVertical size={16} /></button>
          </td>
        </tr>)}</tbody>
      </table>
      {ready2 && !mario.length && <p className={styles.empty}>{t('No hay choferes del grupo Mario todavía.')}</p>}
    </div>}
    {tab === 'mario' && openRow && mario.find(m => m.driverId === openRow) && (() => {
      const m = mario.find(x => x.driverId === openRow)!;
      return <div className={styles.rowDetail}>
        <h3>{m.driverName}</h3>
        <p>
          <b>{t('Descuento 6%:')}</b> {money(m.companyDeduction)} · <b>{t('Combustible:')}</b> {money(m.fuel)} · <b>{t('Seguro:')}</b> {money(m.insurance)}
        </p>
        <form className={styles.insuranceForm} onSubmit={e => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get('insurance') || 0); void saveInsurance(m.driverId, v); }}>
          <label>{t('Seguro semanal')}<input name="insurance" type="number" min="0" step="0.01" defaultValue={m.insurance} disabled={locked} /></label>
          <button type="submit" disabled={busy || locked}>{t('Guardar')}</button>
        </form>
        <div className={styles.actions}>
          <button disabled={busy || locked} onClick={() => toggleMark(m.driverId, m.driverName, m.paymentStatus)}>{m.paymentStatus === 'Pagada' ? t('Marcar pendiente') : t('Marcar pagada')}</button>
          <button onClick={() => setOpenRow(null)}>{t('Cerrar')}</button>
        </div>
      </div>;
    })()}

    {tab === 'ownerOperators' && <>
      <p className={styles.note}>{t('Reporte angosto (spec 9.10): del bruto de la semana, el 12% se lo queda Mario; del 88% restante se le descuenta al Owner Operator el combustible que gastó con la tarjeta de la compañía, y lo que queda es lo que Mario le paga. No es una liquidación completa.')}</p>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead><tr><th>{t('Chofer')}</th><th>{t('Cargas')}</th><th>{t('Bruto')}</th><th>{t('Corte de Mario (12%)')}</th><th>{t('Combustible gastado')}</th><th>{t('A pagarle')}</th></tr></thead>
          <tbody>{ownerOperators.map((o, i) => <tr key={o.driverId}>
            <td><span className={styles.who}><Avatar name={o.driverName} index={i} />{o.driverName}</span></td>
            <td className={styles.tableSub}>{o.loadsCount}</td>
            <td>{money(o.gross)}</td>
            <td className={styles.tableSub}>{money(o.marioCut)}</td>
            <td className={styles.tableSub}>{money(o.fuel)}</td>
            <td><strong>{money(o.netPayout)}</strong></td>
          </tr>)}</tbody>
        </table>
        {ready2 && !ownerOperators.length && <p className={styles.empty}>{t('No hay choferes del grupo Owner Operators todavía.')}</p>}
      </div>
    </>}

    {tab === 'lazaro' && <>
      <p className={styles.note}>{t('Lázaro les paga a sus choferes aparte, fuera de este sistema. Aquí solo se ve su bruto de la semana, que entra junto con Mario y Owner Operators en la comisión del despachador de arriba.')}</p>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead><tr><th>{t('Chofer')}</th><th>{t('Cargas')}</th><th>{t('Bruto')}</th></tr></thead>
          <tbody>{lazaro.map((l, i) => <tr key={l.driverId}>
            <td><span className={styles.who}><Avatar name={l.driverName} index={i} />{l.driverName}</span></td>
            <td className={styles.tableSub}>{l.loadsCount}</td>
            <td>{money(l.gross)}</td>
          </tr>)}</tbody>
        </table>
        {ready2 && !lazaro.length && <p className={styles.empty}>{t('No hay choferes del grupo Lázaro todavía.')}</p>}
      </div>
    </>}

    {tab === 'dispatcher' && <>
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

    {tab === 'config' && <form className={styles.form} onSubmit={saveConfig}>
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

    {tab !== 'config' && <section className={styles.chartSection}>
      <h3>{t('Distribución de Pagos de la Semana')}</h3>
      <div className={styles.chartRow}>
        <Donut data={distribution} centerLabel={money(distributionTotal)} centerSub={t('Total')} />
        <DonutLegend data={distribution} format={money} />
      </div>
    </section>}
  </div>;
}
