"use client";
import { useState } from 'react';
import {
  computeMarioSettlements, computeOwnerOperatorSettlements, dispatcherCommission,
  weekStartOf, weekRange, paidWithinInvoicePeriod,
} from '../lib/settlements';
import { isOfficial } from '../lib/loads';
import type { SettlementsController } from '../lib/use-settlements';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import type { FuelController } from '../lib/use-fuel';
import { money, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { TrendingUp, TrendingDown, Printer } from 'lucide-react';
import { LineChart } from './mini-charts';
import styles from './reports.module.css';

// REDISEÑO (pedido explícito de la dueña): Reportes repetía casi todo lo que
// ya se ve en Cargas/Combustible/Resumen Semanal, solo que cortado distinto
// (por chofer, por grupo, por compañía) pero siempre de la semana actual. Se
// reemplaza por lo único que ningún otro módulo muestra: TENDENCIAS a través
// de varias semanas — un rango elegible (4/8/12 semanas), la ganancia
// acumulada de la compañía con su tendencia, una gráfica semana a semana y un
// ranking de los choferes de Mario más rentables en ese rango. Se quitan las
// pestañas "Por chofer"/"Por grupo"/"Compañía", el gráfico diario y "Exportar
// a Excel" (pedido explícito, por repetidos/de más).
type RangeWeeks = 4 | 8 | 12;

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

// N semanas terminando en `fromWeekStart` (incluida), de la más vieja a la más
// nueva — así se arma tanto el rango visible como, corriéndolo hacia atrás,
// el rango anterior equivalente para calcular la tendencia.
function weeksEndingAt(fromWeekStart: string, n: number): string[] {
  const result: string[] = [];
  let w = fromWeekStart;
  for (let i = 0; i < n; i++) { result.unshift(w); w = weekRange(w).prevWeek; }
  return result;
}

export default function ReportsModule({ settlements, loads, fuel, fleet, lang, t }: {
  settlements: SettlementsController; loads: LoadsController; fuel: FuelController; fleet: FleetController; lang: Lang; t: (es: string) => string;
}) {
  const [rangeWeeks, setRangeWeeks] = useState<RangeWeeks>(8);
  const ready = loads.ready && fuel.ready && fleet.ready && settlements.ready;

  const currentWeekStart = weekStartOf(today());
  const rangeStarts = weeksEndingAt(currentWeekStart, rangeWeeks);
  const prevRangeStarts = weeksEndingAt(weekRange(rangeStarts[0]).prevWeek, rangeWeeks);
  const rangeLabel = (starts: string[]) => {
    const first = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(`${starts[0]}T12:00:00Z`));
    const lastEnd = new Date(`${weekRange(starts[starts.length - 1]).end}T12:00:00Z`); lastEnd.setUTCDate(lastEnd.getUTCDate() - 1);
    const last = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(lastEnd);
    return `${first} – ${last}`;
  };
  const marioOoIds = new Set(fleet.state.drivers.filter(d => d.group === 'Mario' || d.group === 'Owner Operators').map(d => d.id));

  // Un número por cada semana del rango (nunca inventado — combina lo que
  // Cargas/Combustible/Contabilidad ya calculan, igual que antes).
  function weekStats(weekStart: string) {
    const { end: weekEnd } = weekRange(weekStart);
    const mario = computeMarioSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd, settlements.state.config, settlements.state.driverInsurance, settlements.state.marks);
    const ownerOperators = computeOwnerOperatorSettlements(fleet.state.drivers, loads.state.loads, fuel.state.transactions, fuel.state.expenses, weekStart, weekEnd, settlements.state.config);
    const dispatcher = dispatcherCommission(fleet.state.drivers, loads.state.loads, weekStart, weekEnd, settlements.state.config, settlements.state.weekLocks);
    const ingresos = loads.state.loads
      .filter(l => marioOoIds.has(l.driverId) && isOfficial(l) && l.status !== 'Cancelada' && l.paymentStatus === 'Pagada' && paidWithinInvoicePeriod(l.paidAt, weekStart, weekEnd, settlements.state.weekLocks))
      .reduce((s, l) => s + l.amount, 0);
    const marioProfit = mario.reduce((s, m) => s + m.finalProfit, 0);
    const ooCut = ownerOperators.reduce((s, o) => s + o.marioCut, 0);
    const combustible = mario.reduce((s, m) => s + m.fuel, 0) + ownerOperators.reduce((s, o) => s + o.fuel, 0);
    const companyNet = marioProfit + ooCut - dispatcher.commission;
    return { weekStart, ingresos, combustible, companyNet, mario };
  }

  const rangeStats = rangeStarts.map(weekStats);
  const prevRangeStats = prevRangeStarts.map(weekStats);
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const totalIngresos = sum(rangeStats.map(w => w.ingresos));
  const totalCombustible = sum(rangeStats.map(w => w.combustible));
  const totalCompanyNet = sum(rangeStats.map(w => w.companyNet));
  const prevTotalCompanyNet = sum(prevRangeStats.map(w => w.companyNet));
  const companyTrend = pctChange(totalCompanyNet, prevTotalCompanyNet);

  const weekLabels = rangeStats.map(w => {
    const d = new Date(`${w.weekStart}T12:00:00Z`);
    return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(d);
  });

  // Ranking de choferes de Mario (pedido explícito: solo Mario, ni Owner
  // Operators ni Lázaro) — la MISMA ganancia final que ya calcula
  // computeMarioSettlements (bruto − 6% − combustible del Mudflap importado −
  // salario − seguro), solo que sumada a través del rango en vez de mostrarse
  // semana por semana.
  type DriverAgg = { driverId: string; driverName: string; loadsCount: number; finalProfit: number };
  function aggregateMario(stats: ReturnType<typeof weekStats>[]): Map<string, DriverAgg> {
    const map = new Map<string, DriverAgg>();
    for (const w of stats) for (const m of w.mario) {
      const cur = map.get(m.driverId) || { driverId: m.driverId, driverName: m.driverName, loadsCount: 0, finalProfit: 0 };
      cur.loadsCount += m.loadsCount; cur.finalProfit += m.finalProfit;
      map.set(m.driverId, cur);
    }
    return map;
  }
  const currentAgg = aggregateMario(rangeStats);
  const prevAgg = aggregateMario(prevRangeStats);
  const ranking = Array.from(currentAgg.values())
    .map(d => ({ ...d, trend: pctChange(d.finalProfit, prevAgg.get(d.driverId)?.finalProfit ?? 0) }))
    .sort((a, b) => b.finalProfit - a.finalProfit);

  return <div className={styles.reports}>
    {!ready && <p role="status">{t('Abriendo los registros para los reportes…')}</p>}

    <div className={styles.toolbar}>
      <div className={styles.rangeChips} role="group" aria-label={t('Rango de semanas')}>
        {([4, 8, 12] as RangeWeeks[]).map(n => <button key={n} aria-pressed={rangeWeeks === n} onClick={() => setRangeWeeks(n)}>{n} {t('semanas')}</button>)}
      </div>
      <div className={styles.spacer} />
      <button onClick={() => window.print()}><Printer size={15} /> {t('Exportar a PDF')}</button>
    </div>
    <p className={styles.note}>{rangeLabel(rangeStarts)}</p>

    <div className={styles.heroStat}>
      <div>
        <span className={styles.label}>{t('Ganancia de la compañía')} · {rangeWeeks} {t('semanas')}</span>
        <div className={styles.value}>{ready ? money(totalCompanyNet) : '—'}</div>
        {companyTrend !== null && <span className={styles.trend}>
          {companyTrend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {companyTrend >= 0 ? '+' : ''}{companyTrend.toFixed(0)}% {t('vs. las')} {rangeWeeks} {t('semanas anteriores')}
        </span>}
      </div>
      <p className={styles.sub}>{t('Suma de lo que quedó cada semana, después de combustible, salarios, roturas y comisión del despachador.')}</p>
    </div>

    <div className={styles.chartCard}>
      <h3>{t('Ingresos, Combustible y Ganancia por semana')}</h3>
      <p className={styles.cardSub}>{t('Para ver si el negocio mejora o empeora con el tiempo — no solo el número de una semana.')}</p>
      <LineChart categories={weekLabels} format={money} series={[
        { label: t('Ingresos'), color: '#8B102A', values: rangeStats.map(w => w.ingresos) },
        { label: t('Combustible'), color: '#c98a00', values: rangeStats.map(w => w.combustible) },
        { label: t('Ganancia de la compañía'), color: '#1f7a4d', values: rangeStats.map(w => w.companyNet) },
      ]} />
      <div className={styles.legendRow}>
        <span><i style={{ background: '#8B102A' }} />{t('Ingresos')} · {ready ? money(totalIngresos) : '—'}</span>
        <span><i style={{ background: '#c98a00' }} />{t('Combustible')} · {ready ? money(totalCombustible) : '—'}</span>
        <span><i style={{ background: '#1f7a4d' }} />{t('Ganancia de la compañía')}</span>
      </div>
    </div>

    <div className={styles.rankCard}>
      <h3>{t('Choferes de Mario más rentables')}</h3>
      <p className={styles.cardSub}>{t('Ganancia acumulada en el rango — bruto menos 6%, combustible, salario y seguro, igual que siempre.')}</p>
      {ranking.length > 0 ? <table className={styles.rankTable}>
        <thead><tr><th></th><th>{t('Chofer')}</th><th>{t('Cargas')}</th><th>{t('Ganancia acumulada')}</th><th>{t('Tendencia')}</th></tr></thead>
        <tbody>{ranking.map((d, i) => <tr key={d.driverId}>
          <td><span className={styles.rankNum}>{i + 1}</span></td>
          <td>{d.driverName}</td>
          <td>{d.loadsCount}</td>
          <td><b>{money(d.finalProfit)}</b></td>
          <td>{d.trend === null ? '—' : <span className={d.trend >= 0 ? styles.trendUp : styles.trendDown}>{d.trend >= 0 ? '▲' : '▼'} {Math.abs(d.trend).toFixed(0)}%</span>}</td>
        </tr>)}</tbody>
      </table> : <p className={styles.empty}>{t('No hay choferes del grupo Mario todavía.')}</p>}
    </div>
  </div>;
}
