"use client";
import { useState } from 'react';
import {
  computeMarioSettlements, computeOwnerOperatorSettlements, dispatcherCommission,
  weekStartOf, weekRange,
} from '../lib/settlements';
import type { SettlementsController } from '../lib/use-settlements';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import type { FuelController } from '../lib/use-fuel';
import { money, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { ChevronLeft, ChevronRight, User, Users, Building2 } from 'lucide-react';
import styles from './reports.module.css';

type Tab = 'chofer' | 'grupo' | 'compania';
const inRange = (date: string, start: string, end: string) => date >= start && date < end;

// Reportes SOLO combina/presenta lo que Cargas, Combustible y Contabilidad ya
// calculan (ver nota de arquitectura en lib/dashboard.ts) — nunca recalcula el
// dinero por su cuenta. La única excepción es este desglose de Fuel vs Non-Fuel
// vs Otros gastos, que es puramente informativo (no cambia ningún total oficial).
function fuelBreakdown(driverId: string, transactions: FuelController['state']['transactions'], expenses: FuelController['state']['expenses'], weekStart: string, weekEnd: string) {
  const finalTx = transactions.filter(t => t.driverId === driverId && t.status === 'Final' && inRange(t.date, weekStart, weekEnd));
  const finalEx = expenses.filter(e => e.driverId === driverId && e.status === 'Final' && inRange(e.date, weekStart, weekEnd));
  return {
    fuelOnly: finalTx.reduce((s, t) => s + t.fuelAmount, 0),
    nonFuelOnly: finalTx.reduce((s, t) => s + t.nonFuelAmount, 0),
    otherExpenses: finalEx.reduce((s, e) => s + e.amount, 0),
  };
}

export default function ReportsModule({ settlements, loads, fuel, fleet, lang, t }: {
  settlements: SettlementsController; loads: LoadsController; fuel: FuelController; fleet: FleetController; lang: Lang; t: (es: string) => string;
}) {
  const [tab, setTab] = useState<Tab>('chofer');
  const [weekStart, setWeekStart] = useState(weekStartOf(today()));
  const ready = loads.ready && fuel.ready && fleet.ready && settlements.ready;
  const { end: weekEnd, prevWeek, nextWeek } = weekRange(weekStart);
  const weekLabel = `${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(`${weekStart}T12:00:00Z`))} – ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(new Date(`${weekEnd}T12:00:00Z`).getTime() - 86400000))}`;

  const mario = computeMarioSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd, settlements.state.config, settlements.state.driverInsurance, settlements.state.marks);
  const ownerOperators = computeOwnerOperatorSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd, settlements.state.config);
  const dispatcher = dispatcherCommission(fleet.state.drivers, loads.state.loads, weekStart, weekEnd, settlements.state.config);

  // Lázaro/Dionisio: fuera de alcance para cualquier reporte financiero (spec
  // 7.3a/10.5) — solo se les sigue el combustible/gastos, nada más.
  const otherGroupTotal = (groupName: string) => {
    const ids = fleet.state.drivers.filter(d => d.group === groupName).map(d => d.id);
    const finalTx = fuel.state.transactions.filter(t => ids.includes(t.driverId) && t.status === 'Final' && inRange(t.date, weekStart, weekEnd));
    const finalEx = fuel.state.expenses.filter(e => ids.includes(e.driverId) && e.status === 'Final' && inRange(e.date, weekStart, weekEnd));
    return finalTx.reduce((s, t) => s + t.fuelAmount + t.nonFuelAmount, 0) + finalEx.reduce((s, e) => s + e.amount, 0);
  };
  const lazaroFuel = otherGroupTotal('Lázaro');
  const dionisioFuel = otherGroupTotal('Dionisio');

  const marioTotals = mario.reduce((acc, m) => ({
    loadsCount: acc.loadsCount + m.loadsCount, gross: acc.gross + m.gross, companyDeduction: acc.companyDeduction + m.companyDeduction,
    fuel: acc.fuel + m.fuel, driverPay: acc.driverPay + m.driverPay, insurance: acc.insurance + m.insurance, finalProfit: acc.finalProfit + m.finalProfit,
  }), { loadsCount: 0, gross: 0, companyDeduction: 0, fuel: 0, driverPay: 0, insurance: 0, finalProfit: 0 });
  const ooTotals = ownerOperators.reduce((acc, o) => ({
    gross: acc.gross + o.gross, marioCut: acc.marioCut + o.marioCut, fuel: acc.fuel + o.fuel, netPayout: acc.netPayout + o.netPayout,
  }), { gross: 0, marioCut: 0, fuel: 0, netPayout: 0 });
  const companyNet = marioTotals.finalProfit + ooTotals.marioCut - dispatcher.commission;

  return <div className={styles.reports}>
    {!ready && <p role="status">{t('Abriendo los registros para los reportes…')}</p>}

    <div className={styles.weekBar}>
      <button onClick={() => setWeekStart(prevWeek)} aria-label={t('Semana anterior')}><ChevronLeft size={16} /></button>
      <span>{t('Semana')} {weekLabel}</span>
      <button onClick={() => setWeekStart(nextWeek)} aria-label={t('Semana siguiente')}><ChevronRight size={16} /></button>
      <button onClick={() => setWeekStart(weekStartOf(today()))}>{t('Semana actual')}</button>
    </div>

    <nav className={styles.tabs} aria-label={t('Secciones de reportes')}>
      <button aria-pressed={tab === 'chofer'} onClick={() => setTab('chofer')}><User size={14} /> {t('Por chofer')}</button>
      <button aria-pressed={tab === 'grupo'} onClick={() => setTab('grupo')}><Users size={14} /> {t('Por grupo')}</button>
      <button aria-pressed={tab === 'compania'} onClick={() => setTab('compania')}><Building2 size={14} /> {t('Compañía')}</button>
    </nav>

    {tab === 'chofer' && <div className={styles.cards}>{mario.map(m => {
      const bd = fuelBreakdown(m.driverId, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd);
      return <article className={styles.reportCard} key={m.driverId}>
        <header>{t('RESUMEN DEL CHOFER')}</header>
        <h3>{m.driverName}</h3>
        <p className={styles.sub}>{m.loadsCount} {t('cargas esta semana')}</p>
        <dl>
          <div><dt>{t('TOTAL BRUTO')}</dt><dd>{money(m.gross)}</dd></div>
          <div><dt>{t('DESCUENTO')}</dt><dd>{money(m.companyDeduction)}</dd></div>
          <div><dt>{t('TOTAL DESPUÉS DEL DESCUENTO')}</dt><dd>{money(m.gross - m.companyDeduction)}</dd></div>
          <div><dt>{t('SALARIO')}</dt><dd>{money(m.driverPay)}</dd></div>
          <div><dt>{t('COMBUSTIBLE')}</dt><dd>{money(bd.fuelOnly)}</dd></div>
          <div><dt>{t('NON-FUEL')}</dt><dd>{money(bd.nonFuelOnly)}</dd></div>
          {bd.otherExpenses > 0 && <div><dt>{t('OTROS GASTOS')}</dt><dd>{money(bd.otherExpenses)}</dd></div>}
          <div><dt>{t('SEGURO')}</dt><dd>{money(m.insurance)}</dd></div>
        </dl>
        <footer><span>{t('GANANCIA FINAL')}</span><strong>{money(m.finalProfit)}</strong></footer>
      </article>;
    })}</div>}
    {tab === 'chofer' && ready && !mario.length && <p className={styles.empty}>{t('No hay choferes del grupo Mario todavía.')}</p>}

    {tab === 'grupo' && <div className={styles.groupSections}>
      <section>
        <h3>{t('Mario')}</h3>
        <dl className={styles.groupGrid}>
          <div><dt>{t('Cargas')}</dt><dd>{marioTotals.loadsCount}</dd></div>
          <div><dt>{t('Total bruto')}</dt><dd>{money(marioTotals.gross)}</dd></div>
          <div><dt>{t('Total descuento (6%)')}</dt><dd>{money(marioTotals.companyDeduction)}</dd></div>
          <div><dt>{t('Total combustible')}</dt><dd>{money(marioTotals.fuel)}</dd></div>
          <div><dt>{t('Total pago a choferes')}</dt><dd>{money(marioTotals.driverPay)}</dd></div>
          <div><dt>{t('Total seguro')}</dt><dd>{money(marioTotals.insurance)}</dd></div>
          <div><dt>{t('Ganancia del grupo')}</dt><dd>{money(marioTotals.finalProfit)}</dd></div>
        </dl>
      </section>
      <section>
        <h3>{t('Owner Operators')}</h3>
        <p className={styles.note}>{t('Reporte angosto (spec 9.10/10.5): no es una liquidación completa.')}</p>
        <dl className={styles.groupGrid}>
          <div><dt>{t('Total bruto')}</dt><dd>{money(ooTotals.gross)}</dd></div>
          <div><dt>{t('Corte de Mario (12%)')}</dt><dd>{money(ooTotals.marioCut)}</dd></div>
          <div><dt>{t('Total combustible')}</dt><dd>{money(ooTotals.fuel)}</dd></div>
          <div><dt>{t('Total a pagarles')}</dt><dd>{money(ooTotals.netPayout)}</dd></div>
        </dl>
      </section>
      <section>
        <h3>{t('Lázaro')}</h3>
        <p className={styles.note}>{t('Fuera de alcance para reportes financieros (spec 7.3a) — solo se separa su combustible/gastos.')}</p>
        <dl className={styles.groupGrid}><div><dt>{t('Combustible y gastos de la semana')}</dt><dd>{money(lazaroFuel)}</dd></div></dl>
      </section>
      <section>
        <h3>{t('Dionisio')}</h3>
        <p className={styles.note}>{t('Fuera de alcance para reportes financieros (spec 7.3a) — solo se separa su combustible/gastos.')}</p>
        <dl className={styles.groupGrid}><div><dt>{t('Combustible y gastos de la semana')}</dt><dd>{money(dionisioFuel)}</dd></div></dl>
      </section>
    </div>}

    {tab === 'compania' && <div className={styles.groupSections}>
      <section>
        <h3>{t('Resumen semanal de la compañía')}</h3>
        <p className={styles.note}>{t('Combina Mario + Owner Operators — Lázaro y Dionisio no forman parte del resultado de la compañía (spec 7.3a).')}</p>
        <dl className={styles.groupGrid}>
          <div><dt>{t('Total cargas (Mario)')}</dt><dd>{marioTotals.loadsCount}</dd></div>
          <div><dt>{t('Bruto Mario')}</dt><dd>{money(marioTotals.gross)}</dd></div>
          <div><dt>{t('Bruto Owner Operators')}</dt><dd>{money(ooTotals.gross)}</dd></div>
          <div><dt>{t('Descuento de compañía (6%)')}</dt><dd>{money(marioTotals.companyDeduction)}</dd></div>
          <div><dt>{t('Combustible total')}</dt><dd>{money(marioTotals.fuel + ooTotals.fuel)}</dd></div>
          <div><dt>{t('Pago a choferes de Mario')}</dt><dd>{money(marioTotals.driverPay)}</dd></div>
          <div><dt>{t('Seguro')}</dt><dd>{money(marioTotals.insurance)}</dd></div>
          <div><dt>{t('Corte de Owner Operators para Mario')}</dt><dd>{money(ooTotals.marioCut)}</dd></div>
          <div><dt>{t('Comisión del despachador (4%)')}</dt><dd>{money(dispatcher.commission)}</dd></div>
        </dl>
        <footer className={styles.companyFooter}><span>{t('Ganancia estimada de la compañía')}</span><strong>{money(companyNet)}</strong></footer>
        <p className={styles.note}>{t('Ganancia estimada = ganancia de choferes de Mario + corte de Owner Operators − comisión del despachador.')}</p>
      </section>
    </div>}
  </div>;
}
