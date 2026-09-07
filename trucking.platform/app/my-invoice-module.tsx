"use client";
import { useState } from 'react';
import { dispatcherCommissionDetail, weekStartOf, weekRange } from '../lib/settlements';
import type { SettlementsController } from '../lib/use-settlements';
import type { LoadsController } from '../lib/use-loads';
import type { FleetController } from '../lib/use-fleet';
import { money, today } from '../lib/format';
import type { Lang } from '../lib/i18n';
import { ChevronLeft, ChevronRight, DollarSign } from 'lucide-react';
import styles from './my-invoice.module.css';

export default function MyInvoiceModule({ settlements, loads, fleet, lang, t }: {
  settlements: SettlementsController; loads: LoadsController; fleet: FleetController; lang: Lang; t: (es: string) => string;
}) {
  const [weekStart, setWeekStart] = useState(weekStartOf(today()));
  const ready = settlements.ready && loads.ready && fleet.ready;
  const { end: weekEnd, prevWeek, nextWeek } = weekRange(weekStart);
  const weekLabel = `${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(`${weekStart}T12:00:00Z`))} – ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(new Date(`${weekEnd}T12:00:00Z`).getTime() - 86400000))}`;
  const result = dispatcherCommissionDetail(fleet.state.drivers, loads.state.loads, weekStart, weekEnd, settlements.state.config);

  return <div className={styles.wrap}>
    {!ready && <p role="status">{t('Abriendo tu invoice…')}</p>}
    <div className={styles.weekBar}>
      <button onClick={() => setWeekStart(prevWeek)} aria-label={t('Semana anterior')}><ChevronLeft size={16} /></button>
      <span>📅 {t('Semana')} {weekLabel}</span>
      <button onClick={() => setWeekStart(nextWeek)} aria-label={t('Semana siguiente')}><ChevronRight size={16} /></button>
      <button onClick={() => setWeekStart(weekStartOf(today()))}>{t('Semana actual')}</button>
    </div>

    <div className={styles.invoiceCard}>
      <span className={styles.invoiceIcon}><DollarSign size={22} /></span>
      <span className={styles.invoiceLabel}>{t('Tu comisión de esta semana (4% del bruto de Mario + Owner Operators + Lázaro)')}</span>
      <strong className={styles.invoiceAmount}>{ready ? money(result.commission) : '—'}</strong>
      <span className={styles.invoiceSub}>{t('Bruto de la semana:')} {ready ? money(result.gross) : '—'}</span>
    </div>
    <p className={styles.note}>{t('Este pago es independiente del salario de los choferes — nunca sale de lo que ellos cobran.')}</p>

    <h3>{t('Cargas que forman este total')}</h3>
    <div className={styles.tableWrap}>
      <table className={styles.dataTable}>
        <thead><tr><th>{t('Carga')}</th><th>{t('Chofer')}</th><th>{t('Grupo')}</th><th>{t('Bruto')}</th><th>{t('Comisión (4%)')}</th></tr></thead>
        <tbody>{result.rows.map(r => <tr key={r.loadId}>
          <td>{r.loadNumber || t('Sin número')}</td>
          <td>{r.driverName}</td>
          <td className={styles.tableSub}>{r.group}</td>
          <td className={styles.tableSub}>{money(r.amount)}</td>
          <td><strong>{money(r.commission)}</strong></td>
        </tr>)}</tbody>
      </table>
      {ready && !result.rows.length && <p className={styles.empty}>{t('No hay cargas de estos choferes en esta semana todavía.')}</p>}
    </div>
  </div>;
}
