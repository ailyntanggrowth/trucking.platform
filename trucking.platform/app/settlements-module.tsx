"use client";
import { useState, type FormEvent } from 'react';
import {
  computeMarioSettlements, computeOwnerOperatorSettlements, dispatcherCommission,
  weekStartOf, weekRange, type SettlementConfig,
} from '../lib/settlements';
import type { SettlementsController } from '../lib/use-settlements';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import type { FuelController } from '../lib/use-fuel';
import { money, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { DollarSign, Fuel as FuelIcon, Percent, TrendingUp, ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import styles from './settlements.module.css';

type Tab = 'mario' | 'ownerOperators' | 'config';

export default function SettlementsModule({ settlements, loads, fuel, fleet, lang, t }: {
  settlements: SettlementsController; loads: LoadsController; fuel: FuelController; fleet: FleetController; lang: Lang; t: (es: string) => string;
}) {
  const { state, ready } = settlements;
  const [tab, setTab] = useState<Tab>('mario');
  const [weekStart, setWeekStart] = useState(weekStartOf(today()));
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);

  const ready2 = ready && loads.ready && fuel.ready && fleet.ready;
  const { end: weekEnd, prevWeek, nextWeek } = weekRange(weekStart);
  const mario = computeMarioSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd, state.config, state.driverInsurance, state.marks);
  const ownerOperators = computeOwnerOperatorSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd, state.config);
  const dispatcher = dispatcherCommission(fleet.state.drivers, loads.state.loads, weekStart, weekEnd, state.config);
  const totalGross = mario.reduce((s, m) => s + m.gross, 0);
  const totalFuel = mario.reduce((s, m) => s + m.fuel, 0);
  const totalProfit = mario.reduce((s, m) => s + m.finalProfit, 0);
  const weekLabel = `${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(`${weekStart}T12:00:00Z`))} – ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(new Date(`${weekEnd}T12:00:00Z`).getTime() - 86400000))}`;

  async function toggleMark(driverId: string, driverName: string, current: 'Pendiente' | 'Pagada') {
    if (busy) return; setError(''); setNotice(''); setBusy(true);
    try {
      const next = await settlements.commit({ type: 'mark', driverId, driverName, weekStart, paymentStatus: current === 'Pagada' ? 'Pendiente' : 'Pagada', notes: '' });
      setNotice(next.events[0].detail);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function saveInsurance(driverId: string, amount: number) {
    if (busy) return; setError(''); setNotice(''); setBusy(true);
    try { const next = await settlements.commit({ type: 'insurance', driverId, amount }); setNotice(next.events[0].detail); }
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
      <span>{t('Semana')} {weekLabel}</span>
      <button onClick={() => setWeekStart(nextWeek)} aria-label={t('Semana siguiente')}><ChevronRight size={16} /></button>
      <button onClick={() => setWeekStart(weekStartOf(today()))}>{t('Semana actual')}</button>
    </div>

    <div className={styles.statCards}>
      <div className={styles.statCard} data-tone="blue"><span className={styles.statIcon} aria-hidden="true"><DollarSign size={16} /></span><span className={styles.statLabel}>{t('Bruto Mario')}</span><strong>{ready2 ? money(totalGross) : '—'}</strong></div>
      <div className={styles.statCard} data-tone="amber"><span className={styles.statIcon} aria-hidden="true"><FuelIcon size={16} /></span><span className={styles.statLabel}>{t('Combustible Mario')}</span><strong>{ready2 ? money(totalFuel) : '—'}</strong></div>
      <div className={styles.statCard} data-tone="red"><span className={styles.statIcon} aria-hidden="true"><Percent size={16} /></span><span className={styles.statLabel}>{t('Comisión despachador (4%)')}</span><strong>{ready2 ? money(dispatcher.commission) : '—'}</strong></div>
      <div className={styles.statCard} data-tone="green"><span className={styles.statIcon} aria-hidden="true"><TrendingUp size={16} /></span><span className={styles.statLabel}>{t('Ganancia estimada')}</span><strong>{ready2 ? money(totalProfit) : '—'}</strong></div>
    </div>
    <p className={styles.note}>{t('La comisión del despachador es un pago aparte: se calcula sobre el bruto de Mario + Owner Operators de la semana y no afecta el salario del chofer.')}</p>

    <nav className={styles.tabs} aria-label={t('Secciones de contabilidad')}>
      <button aria-pressed={tab === 'mario'} onClick={() => setTab('mario')}>{t('Choferes de Mario')} ({mario.length})</button>
      <button aria-pressed={tab === 'ownerOperators'} onClick={() => setTab('ownerOperators')}>{t('Owner Operators')} ({ownerOperators.length})</button>
      <button aria-pressed={tab === 'config'} onClick={() => setTab('config')}><Settings size={14} /> {t('Configuración')}</button>
    </nav>
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}

    {tab === 'mario' && <div className={styles.cards}>{mario.map(m => <article className={styles.card} key={m.driverId}>
      <div className={styles.badgeRow}><span className={`${styles.badge} ${m.paymentStatus === 'Pagada' ? styles.badgePaid : styles.badgePending}`}>{t(m.paymentStatus)}</span></div>
      <strong>{m.driverName}</strong>
      <span>{m.loadsCount} {t('cargas')} · {t('Bruto:')} {money(m.gross)}</span>
      <p>
        <b>{t('Descuento 6%:')}</b> {money(m.companyDeduction)} · <b>{t('Combustible:')}</b> {money(m.fuel)}<br />
        <b>{t('Pago chofer:')}</b> {money(m.driverPay)} · <b>{t('Seguro:')}</b> {money(m.insurance)}
      </p>
      <p><b>{t('Ganancia final:')}</b> {money(m.finalProfit)}</p>
      <form className={styles.insuranceForm} onSubmit={e => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get('insurance') || 0); void saveInsurance(m.driverId, v); }}>
        <label>{t('Seguro semanal')}<input name="insurance" type="number" min="0" step="0.01" defaultValue={m.insurance} /></label>
        <button type="submit" disabled={busy}>{t('Guardar')}</button>
      </form>
      <div className={styles.actions}>
        <button disabled={busy} onClick={() => toggleMark(m.driverId, m.driverName, m.paymentStatus)}>{m.paymentStatus === 'Pagada' ? t('Marcar pendiente') : t('Marcar pagada')}</button>
      </div>
    </article>)}</div>}
    {tab === 'mario' && ready2 && !mario.length && <p className={styles.empty}>{t('No hay choferes del grupo Mario todavía.')}</p>}

    {tab === 'ownerOperators' && <>
      <p className={styles.note}>{t('Reporte angosto (spec 9.10): del bruto de la semana, el 12% se lo queda Mario; del 88% restante se le descuenta al Owner Operator el combustible que gastó con la tarjeta de la compañía, y lo que queda es lo que Mario le paga. No es una liquidación completa.')}</p>
      <div className={styles.cards}>{ownerOperators.map(o => <article className={styles.card} key={o.driverId}>
        <strong>{o.driverName}</strong>
        <span>{t('Bruto:')} {money(o.gross)}</span>
        <p><b>{t('Corte de Mario (12%):')}</b> {money(o.marioCut)}</p>
        <p><b>{t('88% del Owner Operator:')}</b> {money(o.driverShare)} · <b>{t('Combustible gastado:')}</b> {money(o.fuel)}</p>
        <p><b>{t('A pagarle al Owner Operator:')}</b> {money(o.netPayout)}</p>
      </article>)}</div>
      {ready2 && !ownerOperators.length && <p className={styles.empty}>{t('No hay choferes del grupo Owner Operators todavía.')}</p>}
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

    <section className={styles.profile}><div className={styles.toolbar}><h2>{t('Historial de cambios')}</h2></div>{state.events.length ? <div className={styles.historyScroll}><ul>{state.events.slice(0, 30).map(ev => <li key={ev.id}>{ev.detail}</li>)}</ul></div> : <p className={styles.empty}>{t('Todavía no hay actividad.')}</p>}</section>
  </div>;
}
