"use client";
import { useState } from 'react';
import {
  computeMarioSettlements, computeOwnerOperatorSettlements, dispatcherCommission,
  weekStartOf, weekRange,
} from '../lib/settlements';
import { isOfficial } from '../lib/loads';
import type { SettlementsController } from '../lib/use-settlements';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import type { FuelController } from '../lib/use-fuel';
import { money, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { ChevronLeft, ChevronRight, User, Users, Building2, TrendingUp, TrendingDown, FileDown, Printer } from 'lucide-react';
import { Donut, DonutLegend, GroupedBarChart } from './mini-charts';
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

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
function csvCell(v: string | number) { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsModule({ settlements, loads, fuel, fleet, lang, t }: {
  settlements: SettlementsController; loads: LoadsController; fuel: FuelController; fleet: FleetController; lang: Lang; t: (es: string) => string;
}) {
  const [tab, setTab] = useState<Tab>('chofer');
  const [weekStart, setWeekStart] = useState(weekStartOf(today()));
  const ready = loads.ready && fuel.ready && fleet.ready && settlements.ready;
  const { end: weekEnd, prevWeek, nextWeek } = weekRange(weekStart);
  const { end: prevWeekEnd } = weekRange(prevWeek);
  const weekLabel = `${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(`${weekStart}T12:00:00Z`))} – ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(new Date(`${weekEnd}T12:00:00Z`).getTime() - 86400000))}`;

  const mario = computeMarioSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd, settlements.state.config, settlements.state.driverInsurance, settlements.state.marks);
  const ownerOperators = computeOwnerOperatorSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd, settlements.state.config);
  const dispatcher = dispatcherCommission(fleet.state.drivers, loads.state.loads, weekStart, weekEnd, settlements.state.config);
  const prevMario = computeMarioSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, prevWeek, prevWeekEnd, settlements.state.config, settlements.state.driverInsurance, settlements.state.marks);
  const prevOwnerOperators = computeOwnerOperatorSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, prevWeek, prevWeekEnd, settlements.state.config);
  const prevDispatcher = dispatcherCommission(fleet.state.drivers, loads.state.loads, prevWeek, prevWeekEnd, settlements.state.config);

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

  const sumTotals = (m: typeof mario) => m.reduce((acc, x) => ({
    loadsCount: acc.loadsCount + x.loadsCount, gross: acc.gross + x.gross, companyDeduction: acc.companyDeduction + x.companyDeduction,
    fuel: acc.fuel + x.fuel, driverPay: acc.driverPay + x.driverPay, insurance: acc.insurance + x.insurance, finalProfit: acc.finalProfit + x.finalProfit,
  }), { loadsCount: 0, gross: 0, companyDeduction: 0, fuel: 0, driverPay: 0, insurance: 0, finalProfit: 0 });
  const sumOo = (o: typeof ownerOperators) => o.reduce((acc, x) => ({
    gross: acc.gross + x.gross, marioCut: acc.marioCut + x.marioCut, fuel: acc.fuel + x.fuel, netPayout: acc.netPayout + x.netPayout,
  }), { gross: 0, marioCut: 0, fuel: 0, netPayout: 0 });

  const marioTotals = sumTotals(mario), ooTotals = sumOo(ownerOperators);
  const prevMarioTotals = sumTotals(prevMario), prevOoTotals = sumOo(prevOwnerOperators);
  const companyNet = marioTotals.finalProfit + ooTotals.marioCut - dispatcher.commission;
  const prevCompanyNet = prevMarioTotals.finalProfit + prevOoTotals.marioCut - prevDispatcher.commission;

  const totalLoads = marioTotals.loadsCount + ownerOperators.reduce((s, o) => s + o.loadsCount, 0);
  const prevTotalLoads = prevMarioTotals.loadsCount + prevOwnerOperators.reduce((s, o) => s + o.loadsCount, 0);
  const totalIngresos = marioTotals.gross + ooTotals.gross, prevTotalIngresos = prevMarioTotals.gross + prevOoTotals.gross;
  const totalCombustible = marioTotals.fuel + ooTotals.fuel, prevTotalCombustible = prevMarioTotals.fuel + prevOoTotals.fuel;

  const kpis = [
    { label: t('Total de Cargas'), value: totalLoads, format: (n: number) => String(n), change: pctChange(totalLoads, prevTotalLoads) },
    { label: t('Ingresos Totales'), value: totalIngresos, format: money, change: pctChange(totalIngresos, prevTotalIngresos) },
    { label: t('Total Combustible'), value: totalCombustible, format: money, change: pctChange(totalCombustible, prevTotalCombustible), invert: true },
    { label: t('Ganancia de la Compañía'), value: companyNet, format: money, change: pctChange(companyNet, prevCompanyNet) },
  ];

  const dayLabels = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekStart}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    return { key: d.toISOString().slice(0, 10), label: new Intl.DateTimeFormat('es', { weekday: 'short' }).format(d) };
  });
  const eligibleIds = new Set(fleet.state.drivers.filter(d => d.group === 'Mario' || d.group === 'Owner Operators').map(d => d.id));
  const ingresosPorDia = dayLabels.map(d => loads.state.loads.filter(l => eligibleIds.has(l.driverId) && isOfficial(l) && l.status !== 'Cancelada' && l.pickupDate === d.key).reduce((s, l) => s + l.amount, 0));
  const gastosPorDia = dayLabels.map(d =>
    fuel.state.transactions.filter(x => eligibleIds.has(x.driverId) && x.status === 'Final' && x.date === d.key).reduce((s, x) => s + x.fuelAmount + x.nonFuelAmount, 0)
    + fuel.state.expenses.filter(x => eligibleIds.has(x.driverId) && x.status === 'Final' && x.date === d.key).reduce((s, x) => s + x.amount, 0));

  const distribution = [
    { label: t('Pago a choferes'), value: marioTotals.driverPay, color: '#8B102A' },
    { label: t('Combustible'), value: totalCombustible, color: '#c98a00' },
    { label: t('Corte Owner Operators (Mario)'), value: ooTotals.marioCut, color: '#1e4e8c' },
    { label: t('Comisión despachador'), value: dispatcher.commission, color: '#1f7a4d' },
    { label: t('Seguro'), value: marioTotals.insurance, color: '#6b3fa0' },
  ];
  const distributionTotal = distribution.reduce((s, d) => s + d.value, 0);

  function exportCsv() {
    const rows: (string | number)[][] = [[t('Reporte'), t(tab === 'chofer' ? 'Por chofer' : tab === 'grupo' ? 'Por grupo' : 'Compañía')], [t('Semana'), weekLabel], []];
    if (tab === 'chofer') {
      rows.push([t('Chofer'), t('Cargas'), t('Bruto'), t('Descuento'), t('Combustible'), t('Pago chofer'), t('Seguro'), t('Ganancia final')]);
      mario.forEach(m => rows.push([m.driverName, m.loadsCount, m.gross, m.companyDeduction, m.fuel, m.driverPay, m.insurance, m.finalProfit]));
    } else if (tab === 'grupo') {
      rows.push([t('Grupo'), t('Cargas'), t('Bruto'), t('Combustible'), t('Total')]);
      rows.push(['Mario', marioTotals.loadsCount, marioTotals.gross, marioTotals.fuel, marioTotals.finalProfit]);
      rows.push(['Owner Operators', ownerOperators.reduce((s, o) => s + o.loadsCount, 0), ooTotals.gross, ooTotals.fuel, ooTotals.netPayout]);
      rows.push(['Lázaro', '', '', lazaroFuel, '']);
      rows.push(['Dionisio', '', '', dionisioFuel, '']);
    } else {
      rows.push([t('Concepto'), t('Monto')]);
      rows.push([t('Bruto Mario'), marioTotals.gross]); rows.push([t('Bruto Owner Operators'), ooTotals.gross]);
      rows.push([t('Combustible total'), totalCombustible]); rows.push([t('Comisión despachador'), dispatcher.commission]);
      rows.push([t('Ganancia estimada de la compañía'), companyNet]);
    }
    downloadCsv(`reporte-${tab}-${weekStart}.csv`, rows);
  }

  return <div className={styles.reports}>
    {!ready && <p role="status">{t('Abriendo los registros para los reportes…')}</p>}

    <div className={styles.weekBar}>
      <button onClick={() => setWeekStart(prevWeek)} aria-label={t('Semana anterior')}><ChevronLeft size={16} /></button>
      <span>📅 {t('Semana')} {weekLabel}</span>
      <button onClick={() => setWeekStart(nextWeek)} aria-label={t('Semana siguiente')}><ChevronRight size={16} /></button>
      <button onClick={() => setWeekStart(weekStartOf(today()))}>{t('Semana actual')}</button>
      <div className={styles.spacer} />
      <button onClick={exportCsv}><FileDown size={15} /> {t('Exportar a Excel')}</button>
      <button onClick={() => window.print()}><Printer size={15} /> {t('Exportar a PDF')}</button>
    </div>

    <div className={styles.kpiGrid}>{kpis.map((k, i) => {
      const positive = k.change !== null && (k.invert ? k.change <= 0 : k.change >= 0);
      return <div className={styles.kpiCard} key={i}>
        <span className={styles.kpiLabel}>{k.label}</span>
        <strong>{ready ? k.format(k.value) : '—'}</strong>
        {k.change !== null && ready && <span className={`${styles.kpiTrend} ${positive ? styles.trendUp : styles.trendDown}`}>{positive ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {k.change >= 0 ? '+' : ''}{k.change.toFixed(0)}% {t('vs. semana anterior')}</span>}
      </div>;
    })}</div>

    <div className={styles.chartsGrid}>
      <section className={styles.chartCard}>
        <h3>{t('Ingresos vs Gastos (por día)')}</h3>
        <GroupedBarChart categories={dayLabels.map(d => d.label)} format={money} series={[
          { label: t('Ingresos'), color: '#8B102A', values: ingresosPorDia },
          { label: t('Gastos'), color: '#c98a00', values: gastosPorDia },
        ]} />
        <div className={styles.legendRow}><span><i style={{ background: '#8B102A' }} />{t('Ingresos')}</span><span><i style={{ background: '#c98a00' }} />{t('Gastos')}</span></div>
      </section>
      <section className={styles.chartCard}>
        <h3>{t('Distribución de Gastos')}</h3>
        <div className={styles.chartRow}>
          <Donut data={distribution} centerLabel={money(distributionTotal)} centerSub={t('Total')} />
          <DonutLegend data={distribution} format={money} />
        </div>
      </section>
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
          <div><dt>{t('Combustible total')}</dt><dd>{money(totalCombustible)}</dd></div>
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
